// The smart-account payment scheme — layer 2.
//
// `ExactStellarScheme` cannot pay from a Soroban smart account: it signs through
// `AssembledTransaction.signAuthEntries`, which narrows the signer's result to a
// naked buffer and routes `authorizeEntry` down its ed25519 branch. For a
// `C…` credential address that throws (filed upstream as
// x402-foundation/x402#3159).
//
// So we register our OWN scheme client instead. `x402Client.register()` accepts
// any `SchemeNetworkClient`, which is a documented extension point — this is not
// a fork, and it does not wait on the upstream fix. Writing the scheme ourselves
// also means we never call `signAuthEntries` at all: we sign the auth entries
// directly with the SDK's V1 smart-account signer, so the narrowing that blocks
// the official path simply never happens.
//
// Everything else the official scheme does is preserved: SEP-41 transfer
// assembly, NULL_ACCOUNT simulation (no funded source account), ledger-derived
// expiry, and the post-signing re-simulation.

import { Address, rpc, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import {
  assertAuthEntryInvocation,
  type ExpectedInvocation,
  type SmartAccountX402Signer,
} from "vellar-sdk";
import { log } from "./output.js";
import type { X402Requirement } from "./protocol.js";

/** Ledger close time used to turn the server's timeout into a ledger window. */
const ESTIMATED_LEDGER_SECONDS = 5;
/** Stay under the facilitator's own computed maxLedger — it reads its ledger a
 * beat after we read ours, so its "current" is ≥ ours. */
const EXPIRATION_SAFETY_MARGIN = 2;
const MIN_EXPIRATION_LEDGERS = 3;
/**
 * Upper bound on the signature validity a seller can ask for (security audit
 * V-7). `maxTimeoutSeconds` arrives in the 402 challenge — attacker-controlled —
 * and previously had a floor but no ceiling, so a seller advertising 86,400
 * bought a signature valid ~17,000 ledgers. Anyone who then obtained that
 * payload could choose when it settled.
 *
 * 300s is set from measurement, not taste. A signature must survive exactly ONE
 * attempt, because every retry re-signs (see `payer.ts`) and there is no
 * backoff. Measured against a live local facilitator, the worst sign-to-settled
 * window was 12.0s (~3 ledgers), typical 8s. 300s is ~25x that worst case, so no
 * legitimate settlement is affected, while a hostile seller's window shrinks
 * from 24 hours to 5 minutes — roughly 288x less exposure.
 */
const MAX_EXPIRATION_SECONDS = 300;
/**
 * Smallest signature window we will accept (security audit V-13).
 *
 * The measured worst sign-to-settled window is 12.0s; `MIN_EXPIRATION_LEDGERS`
 * (3 ≈ 15s) leaves only ~3s of headroom, so a seller advertising a very short
 * `maxTimeoutSeconds` gets a signature that can expire mid-settle. Nothing is
 * spent when that happens — the facilitator rejects at verify — but the caller
 * sees an opaque failure rather than "the seller's window was too short".
 *
 * We cannot fix it by signing for longer: the facilitator derives its own
 * `maxLedger` from the same `maxTimeoutSeconds` and rejects anything beyond it
 * as `expiration_too_far`. So the honest response is to refuse up front and say
 * why. 5 ledgers (~25s) is ~2x the measured worst case.
 */
const MIN_VIABLE_EXPIRATION_LEDGERS = 5;

const NETWORK_PASSPHRASE: Record<string, string> = {
  "stellar:testnet": "Test SDF Network ; September 2015",
  "stellar:pubnet": "Public Global Stellar Network ; September 2015",
};

export interface SmartAccountSchemeDeps {
  /** Produces V1 auth-entry signatures the wallet's `__check_auth` accepts. */
  signer: SmartAccountX402Signer;
  rpcUrl: string;
  /**
   * Permit a plaintext `http://` RPC. Default false, and deliberately NOT
   * exposed as an environment variable — a plaintext RPC is exactly the
   * position an attacker needs for V-1, so enabling it must be a code decision,
   * not a deployment typo. Used by the hostile-RPC test.
   */
  allowHttp?: boolean;
}

/** The subset of `SchemeNetworkClient` @x402/core actually calls on a client. */
export interface SchemeClientLike {
  readonly scheme: string;
  createPaymentPayload(
    x402Version: number,
    requirements: X402Requirement,
    context?: { extensions?: Record<string, unknown> | null },
  ): Promise<{ x402Version: number; payload: { transaction: string } }>;
}

function expirationLedgersFor(maxTimeoutSeconds: number): number {
  // CLAMP, don't reject. A merchant with a generous timeout is not attacking
  // anyone, and refusing would break legitimate sellers for no security gain —
  // we are never obliged to honour the full window they ask for. The clamp
  // neutralises the risk on its own, so the payment proceeds and the operator is
  // told on stderr rather than the payment failing.
  const requested = Math.min(maxTimeoutSeconds, MAX_EXPIRATION_SECONDS);
  if (maxTimeoutSeconds > MAX_EXPIRATION_SECONDS) {
    log("warn", "clamped the seller's requested signature lifetime", {
      requestedSeconds: maxTimeoutSeconds,
      clampedToSeconds: MAX_EXPIRATION_SECONDS,
      reason:
        "a signature valid far beyond one settlement attempt can be held and settled later",
    });
  }
  const window = Math.ceil(requested / ESTIMATED_LEDGER_SECONDS);
  const offset = Math.max(window - EXPIRATION_SAFETY_MARGIN, MIN_EXPIRATION_LEDGERS);

  if (offset < MIN_VIABLE_EXPIRATION_LEDGERS) {
    // Refuse rather than sign something likely to expire in flight. Nothing is
    // at risk either way — an expired signature is rejected at verify and
    // nothing is spent — but an up-front refusal names the cause instead of
    // surfacing an opaque settlement failure.
    throw new UnworkableTimeoutError(maxTimeoutSeconds, offset);
  }
  return offset;
}

/**
 * A scheme client that pays from a Soroban smart account.
 *
 * The payer is the wallet contract; the agent's ed25519 session key signs, and
 * any policies its `SignerLimits` require are carried in the signature map. The
 * spending limit is enforced on-chain inside `__check_auth` — this client cannot
 * exceed it, and neither can anything that drives this client.
 */
export function createSmartAccountScheme(deps: SmartAccountSchemeDeps): SchemeClientLike {
  const server = new rpc.Server(deps.rpcUrl, { allowHttp: deps.allowHttp ?? false });

  return {
    scheme: "exact",

    async createPaymentPayload(x402Version, requirements) {
      const passphrase = NETWORK_PASSPHRASE[requirements.network];
      if (!passphrase) {
        throw new Error(`Unsupported Stellar network: ${requirements.network}`);
      }
      if (requirements.extra?.areFeesSponsored !== true) {
        throw new Error("Exact scheme requires areFeesSponsored to be true");
      }

      // No `publicKey` — simulation runs from the SDK's NULL_ACCOUNT, so the
      // payer is never the transaction source and no funded classic account is
      // needed. (Older Vellar examples passed SIM_SOURCE_ACCOUNT; obsolete.)
      const tx = await AssembledTransaction.build({
        contractId: requirements.asset,
        method: "transfer",
        args: [
          nativeToScVal(deps.signer.address, { type: "address" }),
          nativeToScVal(requirements.payTo, { type: "address" }),
          nativeToScVal(BigInt(requirements.amount), { type: "i128" }),
        ],
        networkPassphrase: passphrase,
        rpcUrl: deps.rpcUrl,
        allowHttp: deps.allowHttp ?? false,
        parseResultXdr: (r: unknown) => r,
      });

      if (!tx.built) {
        throw new Error("Failed to assemble the transfer (simulation returned nothing).");
      }

      const latest = await server.getLatestLedger();
      const expirationLedger =
        latest.sequence + expirationLedgersFor(requirements.maxTimeoutSeconds);

      // Sign every auth entry belonging to the wallet. Fresh every call —
      // signatures expire in ledgers (~5s each), so a cached payload is a
      // payload that will be rejected.
      // What we intend to authorise. The entries below arrived from the RPC's
      // simulation, so they are untrusted input until compared against this.
      const expected: ExpectedInvocation = {
        contract: requirements.asset,
        functionName: "transfer",
        from: deps.signer.address,
        to: requirements.payTo,
        amount: BigInt(requirements.amount),
      };

      const op = tx.built.operations[0] as { auth?: xdr.SorobanAuthorizationEntry[] };
      const auth = op.auth ?? [];
      let signed = 0;
      for (let i = 0; i < auth.length; i++) {
        const entry = auth[i]!;
        if (entry.credentials().switch().name !== "sorobanCredentialsAddress") continue;
        const addr = Address.fromScAddress(entry.credentials().address().address()).toString();
        if (addr !== deps.signer.address) continue;

        // The credential address only says "this is mine to sign". This says
        // WHAT it is. Security audit V-1 — the on-chain policy validates token
        // and amount and has no opinion on the recipient, so a redirected
        // payment within the cap would satisfy it completely. This is the only
        // check standing between a hostile RPC and a signature over an
        // attacker-chosen recipient.
        assertAuthEntryInvocation(entry, expected);

        const signedXdr = await deps.signer.signAuthEntry(entry.toXDR("base64"), {
          networkPassphrase: passphrase,
          expirationLedger,
        });
        auth[i] = xdr.SorobanAuthorizationEntry.fromXDR(signedXdr, "base64");
        signed++;
      }
      if (signed === 0) {
        throw new Error(
          `No auth entry found for the paying wallet ${deps.signer.address}.`,
        );
      }
      op.auth = auth;

      // Re-simulate AFTER signing. This is where `__check_auth` — and therefore
      // the spending-limit policy — actually executes; the pre-signing
      // simulation runs in recording mode and never consults it. Skipping this
      // ships a payload whose resource fee omits the auth path, and hides a
      // policy refusal until the facilitator hits it.
      await tx.simulate({ restore: false });
      const sim = tx.simulation;
      if (!sim || rpc.Api.isSimulationError(sim)) {
        const detail = sim && "error" in sim ? String(sim.error) : "unknown simulation failure";
        throw new SmartAccountAuthError(detail);
      }

      return { x402Version, payload: { transaction: tx.built.toXDR() } };
    },
  };
}

/**
 * `__check_auth` refused the signed entry.
 *
 * DO NOT classify on the top-level contract error code. The wallet wraps every
 * auth failure in its own `Error(Contract, #110)`, including the case where a
 * policy it invoked rejected the payment — so `#110` alone says only "auth
 * failed", not why. Verified on testnet: an over-cap payment surfaces `#110` at
 * the top with the real cause nested in the diagnostic events:
 *
 *   [wallet] "contract try_call failed", policy__, [ …transfer args… ]
 *   [policy] "VM call trapped with HostError", policy__, Error(Contract, #1)
 *
 * The presence of a failed `policy__` call is the signal that a POLICY refused —
 * i.e. layer 2 doing its job — as distinct from a malformed signature map.
 */
export class SmartAccountAuthError extends Error {
  /** True when a policy contract was invoked and rejected the payment. */
  readonly policyRejected: boolean;

  constructor(readonly detail: string) {
    const policyRejected = /try_call failed.*policy__|policy__.*Error\(Contract, #1\)/s.test(detail);
    super(
      `The smart account did not authorise this payment. ` +
        (policyRejected
          ? "A spending policy attached to the signing key REFUSED it — this is the on-chain " +
            "budget being enforced, not a client error. The payment exceeds what the wallet " +
            "permits, and no retry or larger max_amount will change that."
          : "No policy rejection was found in the diagnostics, so this is more likely a " +
            "signature-map or signer-configuration problem than a budget decision — check " +
            "VELLAR_X402_WALLET and VELLAR_X402_POLICIES against the wallet's on-chain signers.") +
        `\n\n${detail}`,
    );
    this.name = "SmartAccountAuthError";
    this.policyRejected = policyRejected;
  }
}

/**
 * The seller's `maxTimeoutSeconds` is too short for a payment to complete.
 *
 * Security audit V-13. Refused before signing: the window it allows is below
 * what a settlement has been measured to need, and signing anyway would produce
 * a signature that expires mid-flight and fails opaquely. Nothing was spent.
 */
export class UnworkableTimeoutError extends Error {
  constructor(
    readonly maxTimeoutSeconds: number,
    readonly ledgers: number,
  ) {
    super(
      `The resource server allows only ${maxTimeoutSeconds}s to settle, which is about ` +
        `${ledgers} ledgers — below the ~25s a settlement has been measured to need. ` +
        `Refusing before signing rather than producing a signature that expires mid-payment. ` +
        `Nothing was spent. This is the seller's configuration, not a fault in the payment.`,
    );
    this.name = "UnworkableTimeoutError";
  }
}
