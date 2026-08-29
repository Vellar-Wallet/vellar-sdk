// x402 payment submission — builds and signs the SEP-41 transfer that satisfies
// a decoded x402 payment requirement.
//
// Split out of ./x402-client (#299): that module now owns orchestration (the
// fetch/retry flow, budget-attribute wiring, settlement reading) while this one
// owns the actual "turn PaymentRequirements into a signed PAYMENT-SIGNATURE
// header" step — simulate the transfer, derive a signature-expiration ledger
// from the server's timeout, verify the auth entry says what we think it says,
// and sign it with the injected smart-account signer.
//
// Pairs with ./x402-guards (the pure decode/select layer) — together they are
// the module split this issue asks for: discovery (guards) vs. payment
// submission (this file). ./x402-client composes both plus the signer/RPC deps
// into the public X402Client.

import { Address, nativeToScVal, rpc, xdr } from "@stellar/stellar-sdk";
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { assertAuthEntryInvocation, type ExpectedInvocation } from "./x402-auth-entry";
import type { Network } from "./types";
import { NETWORKS, parseAmount, utf8ToBase64 } from "./x402-guards";
import { NoUsablePaymentOptionError, type PaymentRequirements, type SmartAccountX402Signer } from "./x402-types";

// Estimated ledger close time (seconds). The facilitator fetches its own estimate
// from Horizon (~5s on testnet/pubnet); we use the same constant so our derived
// expiration tracks its `maxLedger = current + ceil(maxTimeoutSeconds / ~5)`.
const ESTIMATED_LEDGER_SECONDS = 5;
// Ledgers we stay UNDER the facilitator's computed maxLedger, to absorb drift
// between our getLatestLedger() read and the facilitator's (it reads a beat
// later, so ITS current ledger is ≥ ours; a margin keeps us inside its window
// even though it grants a +2 tolerance).
const EXPIRATION_SAFETY_MARGIN = 2;
// Never sign an expiration less than this many ledgers out, even for a tiny
// server timeout — below this the payment can't realistically round-trip.
const MIN_EXPIRATION_LEDGERS = 3;
/**
 * Default ceiling on seller-requested signature lifetime (security audit V-7).
 * `maxTimeoutSeconds` is attacker-controlled and previously had no upper bound
 * here unless a caller passed `expirationLedgerOffset`. 300s / 5s = 60 ledgers,
 * less the safety margin. See the scheme client for the measurement behind 300s.
 */
const DEFAULT_MAX_EXPIRATION_LEDGERS = 58;

/**
 * Ledgers-from-now to set as the signature expiration. Derived from the server's
 * `maxTimeoutSeconds` so we stay inside the facilitator's own `maxLedger` window
 * (a fixed offset would exceed a short server timeout and be rejected as
 * `expiration_too_far`). Kept a safety margin below the facilitator's ceiling,
 * floored at MIN_EXPIRATION_LEDGERS, and optionally capped by `ceiling`.
 *
 * Exported for testing; the ceiling is the client's `expirationLedgerOffset`.
 */
export function expirationOffsetFor(
  maxTimeoutSeconds: number | undefined,
  ceiling?: number,
): number {
  const windowLedgers = Math.ceil((maxTimeoutSeconds ?? 120) / ESTIMATED_LEDGER_SECONDS);
  let offset = windowLedgers - EXPIRATION_SAFETY_MARGIN;
  // An explicit ceiling still wins; absent one, fall back to the default bound
  // rather than honouring whatever the seller asked for.
  offset = Math.min(offset, ceiling ?? DEFAULT_MAX_EXPIRATION_LEDGERS);
  return Math.max(offset, MIN_EXPIRATION_LEDGERS);
}

/** Deps a payment build needs from the client — RPC access and the signer. */
export interface BuildSignedPaymentDeps {
  signer: SmartAccountX402Signer;
  rpcUrl: string;
  server: rpc.Server;
  simulationSourceAccount: string;
  /** Hard ceiling on the derived expiration offset (undefined ⇒ no ceiling). */
  expirationCeiling?: number;
}

/**
 * Build and sign the SEP-41 transfer for `requirements`, returning the
 * base64 `PAYMENT-SIGNATURE` header value and the amount that will be paid.
 *
 * Callers (./x402-client) are expected to have already run the guard checks
 * (maxAmount, allowedAssets, budget attributes) — this function does not
 * re-check them; it only builds, simulates, and signs.
 */
export async function buildSignedPayment(
  requirements: PaymentRequirements,
  deps: BuildSignedPaymentDeps,
): Promise<{ header: string; amount: bigint }> {
  const net = NETWORKS[requirements.network];
  if (!net) throw new NoUsablePaymentOptionError(`Unknown network ${requirements.network}`);

  // Build the SEP-41 transfer(from = C-address, to = payTo, amount).
  const tx = await AssembledTransaction.build({
    contractId: requirements.asset,
    method: "transfer",
    args: [
      nativeToScVal(deps.signer.address, { type: "address" }),
      nativeToScVal(requirements.payTo, { type: "address" }),
      nativeToScVal(parseAmount(requirements.amount), { type: "i128" }),
    ],
    networkPassphrase: net.passphrase,
    rpcUrl: deps.rpcUrl,
    publicKey: deps.simulationSourceAccount,
    parseResultXdr: (r: unknown) => r,
  });

  const latest = await deps.server.getLatestLedger();
  const expirationLedger =
    latest.sequence + expirationOffsetFor(requirements.maxTimeoutSeconds, deps.expirationCeiling);

  if (!tx.built) {
    throw new Error(
      "x402: failed to build the transfer transaction (simulation returned nothing).",
    );
  }
  const built = tx.built;

  // What we intend to authorise. `built` came back from the RPC's simulation,
  // so its auth entries are untrusted input until compared against this.
  const expected: ExpectedInvocation = {
    contract: requirements.asset,
    functionName: "transfer",
    from: deps.signer.address,
    to: requirements.payTo,
    amount: parseAmount(requirements.amount),
  };

  // Sign every wallet auth entry (V1) via the injected signer.
  const op = built.operations[0] as { auth?: xdr.SorobanAuthorizationEntry[] };
  const auth = op.auth ?? [];
  let signed = 0;
  for (let i = 0; i < auth.length; i++) {
    const entry = auth[i]!;
    if (entry.credentials().switch().name !== "sorobanCredentialsAddress") continue;
    const addr = Address.fromScAddress(entry.credentials().address().address()).toString();
    if (addr !== deps.signer.address) continue;

    // Security audit V-1. The credential address only establishes that the
    // entry is ours to sign; this establishes WHAT it does. Predates the
    // smart-account work — the classic path has always had this gap.
    assertAuthEntryInvocation(entry, expected);

    const signedXdr = await deps.signer.signAuthEntry(entry.toXDR("base64"), {
      networkPassphrase: net.passphrase,
      expirationLedger,
    });
    auth[i] = xdr.SorobanAuthorizationEntry.fromXDR(signedXdr, "base64");
    signed++;
  }
  if (signed === 0) {
    throw new Error("No wallet auth entry found to sign for the payer address.");
  }
  op.auth = auth;

  const payload = {
    x402Version: 2,
    accepted: requirements,
    payload: { transaction: built.toXDR() },
  };
  return {
    header: utf8ToBase64(JSON.stringify(payload)),
    amount: parseAmount(requirements.amount),
  };
}

/** Build the `X402Settlement` shape from a paid response's settlement header. */
export function readSettlement(
  decoded: { transaction: string; payer?: string } | undefined,
  requirements: PaymentRequirements,
  amount: bigint,
  network: Network,
): { transaction: string; payer: string; asset: string; amount: bigint; network: Network } | undefined {
  if (!decoded) return undefined;
  return {
    transaction: decoded.transaction,
    payer: decoded.payer ?? requirements.payTo,
    asset: requirements.asset,
    amount,
    network,
  };
}
