// Validate WHAT we are about to sign.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS (security audit V-1, Critical)
//
// Soroban auth entries are not built locally. `AssembledTransaction.build()`
// obtains them from the RPC's `simulateTransaction` response — so the thing we
// sign arrives from the network. Until this module existed, the only check
// before signing was that the entry's CREDENTIAL ADDRESS was our wallet. That
// check says "this entry is for me to sign"; it says nothing about what it does.
//
// A hostile or MITM'd RPC could therefore return an entry credentialed to our
// wallet whose invocation paid an address of the attacker's choosing. We would
// verify the address, sign, and re-simulate — against the same hostile RPC.
//
// WHAT LAYER 2 DOES AND DOES NOT COVER — this distinction must survive into
// anything said publicly about this SDK:
//
//   The on-chain spending-limit policy validates the TOKEN and the AMOUNT.
//   It has NO OPINION ON THE RECIPIENT.
//
// So "the agent cannot exceed its budget" is true, and "the agent's funds are
// protected" is NOT. A redirected payment within the cap satisfies the policy
// completely. The chain does not save us from V-1; only this check does.
// ─────────────────────────────────────────────────────────────────────────────

import { Address, scValToNative, xdr } from "@stellar/stellar-sdk";

/** The payment we intended, to compare the entry against. */
export interface ExpectedInvocation {
  /** SEP-41 token contract the transfer must call. */
  contract: string;
  /** Function name — `transfer` for the x402 exact scheme. */
  functionName: string;
  /** Payer; the smart account or keypair that signs. */
  from: string;
  /** Recipient, taken from the payment requirements we cleared. */
  to: string;
  /** Amount in the asset's base units. */
  amount: bigint;
}

/** The entry did not match what we intended to authorise. Never sign after this. */
export class AuthEntryMismatchError extends Error {
  constructor(
    readonly field: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `Refusing to sign: the authorization entry does not match the intended payment. ` +
        `${field} expected ${expected}, got ${actual}. ` +
        `The entry came from the RPC's simulation — a mismatch means the RPC returned ` +
        `something other than the payment that was cleared, and signing it would authorise ` +
        `that instead.`,
    );
    this.name = "AuthEntryMismatchError";
  }
}

function addressOf(value: xdr.ScVal, field: string): string {
  try {
    return Address.fromScVal(value).toString();
  } catch {
    throw new AuthEntryMismatchError(field, "an address", "a non-address ScVal");
  }
}

/**
 * Assert an auth entry authorises EXACTLY the intended payment, or throw.
 *
 * Checks the contract, the function name, every argument, and that there are no
 * sub-invocations. The sub-invocation check is not incidental: an entry whose
 * root call looks correct can carry additional calls underneath, and signing the
 * entry authorises those too.
 *
 * Call this BEFORE signing, at the site that knows the intended payment. The
 * credential-address check is a different question and does not substitute.
 */
export function assertAuthEntryInvocation(
  entry: xdr.SorobanAuthorizationEntry,
  expected: ExpectedInvocation,
): void {
  const root = entry.rootInvocation();

  const fn = root.function();
  if (fn.switch().name !== "sorobanAuthorizedFunctionTypeContractFn") {
    throw new AuthEntryMismatchError("function type", "a contract call", fn.switch().name);
  }

  const call = fn.contractFn();

  const contract = Address.fromScAddress(call.contractAddress()).toString();
  if (contract !== expected.contract) {
    throw new AuthEntryMismatchError("contract", expected.contract, contract);
  }

  const name = call.functionName().toString();
  if (name !== expected.functionName) {
    throw new AuthEntryMismatchError("function", expected.functionName, name);
  }

  const args = call.args();
  if (args.length !== 3) {
    throw new AuthEntryMismatchError("argument count", "3", String(args.length));
  }

  const from = addressOf(args[0]!, "from");
  if (from !== expected.from) {
    throw new AuthEntryMismatchError("from", expected.from, from);
  }

  // The one the on-chain policy will not check for us.
  const to = addressOf(args[1]!, "to");
  if (to !== expected.to) {
    throw new AuthEntryMismatchError("to (recipient)", expected.to, to);
  }

  let amount: bigint;
  try {
    amount = BigInt(scValToNative(args[2]!) as bigint | number | string);
  } catch {
    throw new AuthEntryMismatchError("amount", expected.amount.toString(), "a non-numeric ScVal");
  }
  if (amount !== expected.amount) {
    throw new AuthEntryMismatchError("amount", expected.amount.toString(), amount.toString());
  }

  const subs = root.subInvocations();
  if (subs.length !== 0) {
    throw new AuthEntryMismatchError(
      "sub-invocations",
      "none",
      `${subs.length} (signing would authorise them too)`,
    );
  }
}

/** Error thrown when an x402 challenge nonce has already been consumed. */
export class ReplayedChallengeError extends Error {
  constructor(nonce: string) {
    super(`Refusing challenge: challenge nonce ${nonce} was already used (replay attack detected).`);
    this.name = "ReplayedChallengeError";
  }
}

/** Error thrown when an x402 challenge timestamp is expired. */
export class ExpiredChallengeError extends Error {
  constructor(ageMs: number, maxAgeMs: number) {
    super(`Refusing challenge: challenge expired (${ageMs}ms old, max allowed is ${maxAgeMs}ms).`);
    this.name = "ExpiredChallengeError";
  }
}

/** In-memory cache of seen challenge nonces to prevent replay attacks. */
export class ChallengeReplayGuard {
  private readonly seenNonces = new Map<string, number>(); // nonce -> expiry timestamp
  private readonly maxAgeMs: number;

  constructor(maxAgeMs = 5 * 60 * 1000) {
    this.maxAgeMs = maxAgeMs;
  }

  /**
   * Asserts that a challenge has not been seen and is not expired.
   * Records the nonce if valid.
   */
  checkAndRecord(nonce: string, timestamp = Date.now()): void {
    const now = Date.now();
    this.cleanup(now);

    const age = now - timestamp;
    if (age > this.maxAgeMs || age < -30_000) {
      throw new ExpiredChallengeError(age, this.maxAgeMs);
    }

    if (this.seenNonces.has(nonce)) {
      throw new ReplayedChallengeError(nonce);
    }

    this.seenNonces.set(nonce, now + this.maxAgeMs);
  }

  private cleanup(now: number): void {
    for (const [nonce, expiry] of this.seenNonces.entries()) {
      if (now > expiry) {
        this.seenNonces.delete(nonce);
      }
    }
  }

  clear(): void {
    this.seenNonces.clear();
  }
}

export const globalChallengeReplayGuard = new ChallengeReplayGuard();

/** Validates challenge freshness and single-use against the replay guard. */
export function assertFreshChallenge(
  challenge: { nonce: string; timestamp?: number },
  guard: ChallengeReplayGuard = globalChallengeReplayGuard,
): void {
  guard.checkAndRecord(challenge.nonce, challenge.timestamp ?? Date.now());
}

