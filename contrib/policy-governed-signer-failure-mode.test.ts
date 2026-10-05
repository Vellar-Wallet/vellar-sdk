// Unit tests for the policy-governed signer failure mode (issue #387).
//
// The wallet wraps EVERY auth failure in its generic Error(Contract, #110). A
// policy-governed key configured WITHOUT its policies produces that same opaque
// refusal with no diagnostic, and it must not be confused with a policy
// refusing an over-budget payment (same #110, but a nested policy__ call).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MISSING_POLICY_COSIGNER_HINT,
  MissingPolicyCosignerError,
  looksLikeMissingPolicyCosigner,
  missingPolicyCosignerError,
  warnIfPolicyGovernedWithoutPolicies,
  withMissingPolicyCosignerClassification,
} from "./policy-governed-signer-failure-mode.js";
// NOTE: from its module, NOT `../src/index.js` — index re-exports the
// merge-corrupted (non-parsing) `./x402-signer` on `dev`.
import { PaymentRejectedError } from "../src/x402-types.js";

// Captured verbatim from testnet (shared with the mcp payer's fixtures). Both
// carry the wallet's generic auth wrapper; only one shows a policy invocation.
const MALFORMED_MAP_DIAGNOSTICS = `HostError: Error(Auth, InvalidAction)
   0: [Diagnostic Event] contract:CBIELTK6, topics:[error, Error(Auth, InvalidAction)], data:["failed account authentication with error", CAFIATCE, Error(Contract, #110)]`;

const POLICY_REFUSED_DIAGNOSTICS = `HostError: Error(Auth, InvalidAction)
   0: [Diagnostic Event] contract:CBIELTK6, topics:[error, Error(Auth, InvalidAction)], data:["failed account authentication with error", CAFIATCE, Error(Contract, #110)]
   1: [Failed Diagnostic Event] contract:CAFIATCE, topics:[error, Error(Contract, #110)], data:"escalating Ok(ScErrorType::Contract) frame-exit to Err"
   2: [Failed Diagnostic Event] contract:CAFIATCE, topics:[error, Error(Contract, #110)], data:["contract try_call failed", policy__, [CAFIATCE, [Ed25519, Bytes(89b1)], [[Contract, {args: [CAFIATCE, GAVU25UK, 6000000], contract: CBIELTK6, fn_name: transfer}]]]]
   3: [Failed Diagnostic Event] contract:CC24EVD6, topics:[log], data:["VM call trapped with HostError", policy__, Error(Contract, #1)]`;

describe("looksLikeMissingPolicyCosigner", () => {
  it("classifies a bare #110 with no policy invocation as a missing co-signer", () => {
    expect(looksLikeMissingPolicyCosigner(MALFORMED_MAP_DIAGNOSTICS)).toBe(true);
  });

  it("does NOT classify a #110 whose nested policy call refused as a config error", () => {
    // Same top-level code, different fix: this is the budget being enforced.
    expect(looksLikeMissingPolicyCosigner(POLICY_REFUSED_DIAGNOSTICS)).toBe(false);
  });

  it("ignores failures that carry no #110 at all", () => {
    expect(looksLikeMissingPolicyCosigner("Error(Contract, #1)"))
      .toBe(false);
    expect(looksLikeMissingPolicyCosigner("internal server error")).toBe(false);
    expect(looksLikeMissingPolicyCosigner("Error(Contract, #11)"))
      .toBe(false);
  });
});

describe("missingPolicyCosignerError", () => {
  it("names the cause, the fix, and the hint", () => {
    const err = missingPolicyCosignerError(MALFORMED_MAP_DIAGNOSTICS);
    expect(err).toBeInstanceOf(MissingPolicyCosignerError);
    expect(err.name).toBe("MissingPolicyCosignerError");
    expect(err.message).toContain(MISSING_POLICY_COSIGNER_HINT);
    expect(err.message).toMatch(/pass every policy/i);
    expect(err.message).toMatch(/createSessionKeySigner/);
  });

  it("preserves the raw diagnostics and the alternative cause", () => {
    const err = missingPolicyCosignerError(MALFORMED_MAP_DIAGNOSTICS);
    expect(err.message).toContain(MALFORMED_MAP_DIAGNOSTICS);
    expect(err.message).toMatch(/policy refusing an over-budget payment/);
  });

  it("carries the hint constant verbatim for greppers", () => {
    expect(MISSING_POLICY_COSIGNER_HINT).toBe(
      "this signer may require policies to be configured",
    );
  });
});

describe("warnIfPolicyGovernedWithoutPolicies", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("warns when a key declared policy-governed carries no policies", () => {
    warnIfPolicyGovernedWithoutPolicies("createSessionKeySigner", [], true);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/policyGoverned is set but .*policies.* is empty/));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Error(Contract, #110)"));
  });

  it("names the signer kind in the warning", () => {
    warnIfPolicyGovernedWithoutPolicies("createPasskeyX402Signer", [], true);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("createPasskeyX402Signer"));
  });

  it("does not warn when policies accompany the declaration", () => {
    warnIfPolicyGovernedWithoutPolicies(
      "createSessionKeySigner",
      ["CC24EVD6SD7WF2U4GSIBGU7V6LCN3MLZOJZAZCRQNDS3X6KYIL45K2E3"],
      true,
    );
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("does not warn when the declaration is absent or false", () => {
    warnIfPolicyGovernedWithoutPolicies("createSessionKeySigner", [], undefined);
    warnIfPolicyGovernedWithoutPolicies("createSessionKeySigner", [], false);
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe("withMissingPolicyCosignerClassification", () => {
  const bare110 = ((): PaymentRejectedError =>
    new PaymentRejectedError(
      `x402 payment was not accepted (HTTP 402: ${MALFORMED_MAP_DIAGNOSTICS}). ` +
        `If this was over-budget, the on-chain policy rejected it at facilitator verify.`,
      MALFORMED_MAP_DIAGNOSTICS,
    ))();

  it("reclassifies the core client's bare-#110 PaymentRejectedError", async () => {
    const err = await withMissingPolicyCosignerClassification(() =>
      Promise.reject(bare110),
    ).then(
      () => {
        throw new Error("expected the call to reject");
      },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MissingPolicyCosignerError);
    expect((err as Error).message).toContain(MALFORMED_MAP_DIAGNOSTICS);
    expect((err as Error).message).toContain(MISSING_POLICY_COSIGNER_HINT);
  });

  it("does NOT reclassify a policy refusal (same #110, nested policy__ call)", async () => {
    const refusal = new PaymentRejectedError(
      `x402 payment was not accepted (HTTP 402: ${POLICY_REFUSED_DIAGNOSTICS}).`,
      POLICY_REFUSED_DIAGNOSTICS,
    );
    await expect(
      withMissingPolicyCosignerClassification(() => Promise.reject(refusal)),
    ).rejects.toBe(refusal); // passes through untouched — the fix differs
  });

  it("passes through PaymentRejectedError without a #110", async () => {
    const other = new PaymentRejectedError("over budget", "Error(Contract, #1)");
    await expect(
      withMissingPolicyCosignerClassification(() => Promise.reject(other)),
    ).rejects.toBe(other);
  });

  it("passes through non-PaymentRejected errors untouched", async () => {
    const boom = new Error("network down");
    await expect(
      withMissingPolicyCosignerClassification(() => Promise.reject(boom)),
    ).rejects.toBe(boom);
  });

  it("resolves untouched on success", async () => {
    const value = { paid: true as const };
    await expect(
      withMissingPolicyCosignerClassification(() => Promise.resolve(value)),
    ).resolves.toBe(value);
  });
});
