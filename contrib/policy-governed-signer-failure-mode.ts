// Issue #387 — a policy-governed signer configured WITHOUT its policies.
//
// The wallet wraps EVERY auth failure in its generic `Error(Contract, #110)`.
// A key whose SignerLimits require policy co-signers, signing without them,
// produces that same opaque refusal — it reads as a broken signer, and #110
// also covers policy refusals (over budget), so the code alone cannot say
// which fix applies. Verified on testnet: an ed25519-only signature map
// against a policy-governed wallet fails with Error(Contract, #110); the same
// payment carrying the policy entries reaches the policy and is judged on its
// merits.
//
// This module gives the failure a NAME, until this lands in core
// (see "Integration into Core" in contrib/README.md):
//   - looksLikeMissingPolicyCosigner / missingPolicyCosignerError — classify a
//     #110-without-policy-invocation and raise a typed error naming the fix
//   - MissingPolicyCosignerError — the typed error
//   - warnIfPolicyGovernedWithoutPolicies — earliest signal, at construction
//   - withMissingPolicyCosignerClassification — a catch-side wrapper that turns
//     the client's generic PaymentRejectedError into the typed error without
//     touching src/ (contrib PRs may only change files in contrib/)
//
// The diagnostics classifier is kept identical in shape to the one in
// packages/mcp-x402-payer, so both surfaces of this SDK agree on what a policy
// refusal looks like:
//   [wallet] "contract try_call failed", policy__, [ …transfer args… ]
//   [policy] "VM call trapped with HostError", policy__, Error(Contract, #1)

// NOTE: imported from its module, NOT `../src/index.js` — index re-exports
// `./x402-signer`, whose JSDoc is merge-corrupted on `dev` and does not parse.
import { PaymentRejectedError } from "../src/x402-types.js";

/**
 * The WALLET rejected the signed payment inside `__check_auth` because the
 * signature map did not carry the policy co-signers the signing key's
 * `SignerLimits` require (issue #387).
 *
 * Why a dedicated class: the wallet wraps EVERY auth failure — including a
 * policy refusing an over-budget payment — in its own generic
 * `Error(Contract, #110)`, which reads as a broken signer rather than a missing
 * co-signer. A key configured without its policies fails with that same opaque
 * code and no diagnostic to say which fix applies. This error names the actual
 * cause and the fix (configure `policies` on the signer) so the configuration
 * mistake does not masquerade as a wallet/chain fault.
 *
 * Nothing was signed or settled by this error path: the classification happens
 * on the paid request's rejection, after the one legitimate signing round.
 *
 * In core this class moves to `src/x402-types.ts` alongside the other x402
 * errors (see contrib/README.md); it lives here so the contrib module is
 * self-contained against `dev`.
 */
export class MissingPolicyCosignerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingPolicyCosignerError";
  }
}

/** The hint embedded in every missing-co-signer error, for tests and greppers. */
export const MISSING_POLICY_COSIGNER_HINT =
  "this signer may require policies to be configured";

/**
 * Diagnostics that show a POLICY CONTRACT was invoked and refused — i.e. the
 * signature map reached the policy and the policy said no (over budget).
 */
const POLICY_INVOKED_PATTERN = /try_call failed.*policy__|policy__.*Error\(Contract, #1\)/s;

/**
 * Does this failure look like a signature map MISSING its policy co-signers,
 * rather than a policy refusing the payment?
 *
 * True only when the wallet's generic auth wrapper `Error(Contract, #110)` is
 * present AND the diagnostics show no policy was ever invoked — a policy
 * refusal produces the same #110 with a nested `policy__` call, and must NOT
 * be classified as a configuration error. Imperfect by nature (a facilitator
 * that truncates diagnostics looks like a missing co-signer), so the resulting
 * error always carries the raw text and points at the alternative cause too.
 */
export function looksLikeMissingPolicyCosigner(detail: string): boolean {
  if (!detail.includes("Error(Contract, #110)")) return false;
  return !POLICY_INVOKED_PATTERN.test(detail);
}

/**
 * Build the typed error for a #110 that lacks a policy invocation. The message
 * names the fix (configure `policies` on the signer), the hint phrase, and the
 * alternative cause (a policy refusing an over-budget payment), so an operator
 * holding only this error can tell both apart.
 */
export function missingPolicyCosignerError(detail: string): MissingPolicyCosignerError {
  return new MissingPolicyCosignerError(
    `The wallet rejected this signature because the signing key's required policy ` +
      `co-signers are missing from the signature map — ${MISSING_POLICY_COSIGNER_HINT}. ` +
      "Pass every policy in the key's `SignerLimits` as `policies` to createSessionKeySigner " +
      "(or createPasskeyX402Signer) and sign again. " +
      "The wallet wraps EVERY auth failure in this same contract error, including a policy " +
      "refusing an over-budget payment — so if the signer IS configured with its policies, " +
      "the cause is more likely a policy refusal than a missing co-signer. " +
      "Nothing was signed or settled by this rejection." +
      `\n\n${detail}`,
  );
}

/**
 * Warn (never refuse) when a key DECLARED policy-governed carries no policies.
 *
 * The SDK cannot read the wallet's on-chain `SignerLimits` — that needs an RPC
 * round-trip and a wallet-contract client the x402 signer deliberately does
 * not own — so the caller states whether the key is policy governed and this
 * catches the one combination that cannot work on chain. A warning, not a
 * throw: refusing to construct would break callers that inspect or retry
 * before configuring, and the misconfiguration is caught again — with the full
 * raw diagnostics — by `missingPolicyCosignerError` at fetch time.
 *
 * In core this becomes a call at the top of `createSessionKeySigner` /
 * `createPasskeyX402Signer` (see contrib/README.md); standalone, call it when
 * you construct the signer.
 */
export function warnIfPolicyGovernedWithoutPolicies(
  signerKind: string,
  policies: readonly string[],
  policyGoverned: boolean | undefined,
): void {
  if (policyGoverned !== true || policies.length > 0) return;
  console.warn(
    `[vellar-sdk] ${signerKind}: policyGoverned is set but \`policies\` is empty. ` +
      "A policy-governed key signs with an incomplete signature map, which the wallet rejects " +
      "with Error(Contract, #110) before the policy is ever consulted. Pass every policy in " +
      "the key's SignerLimits as `policies`.",
  );
}

/**
 * Run `doFetch`, reclassifying the wallet's generic auth rejection.
 *
 * The core client throws `PaymentRejectedError` with the facilitator's raw
 * reason for ANY 4xx on the paid retry — a policy-governed key missing its
 * policies lands there with the reason carrying `Error(Contract, #110)`. This
 * wrapper catches that one shape and rethrows the typed
 * `MissingPolicyCosignerError`; everything else (including a genuine policy
 * refusal, which carries a nested `policy__` diagnostic) passes through
 * untouched. Use it around `wallet.x402.fetch(...)` while the classification
 * lives in contrib rather than core.
 *
 * Never swallows: errors that don't match the classifier are rethrown as-is,
 * and the rethrown typed error preserves the full raw diagnostics.
 */
export async function withMissingPolicyCosignerClassification<T>(
  doFetch: () => Promise<T>,
): Promise<T> {
  try {
    return await doFetch();
  } catch (err) {
    if (
      err instanceof PaymentRejectedError &&
      looksLikeMissingPolicyCosigner(err.reason ?? err.message)
    ) {
      throw missingPolicyCosignerError(err.reason ?? err.message);
    }
    throw err;
  }
}
