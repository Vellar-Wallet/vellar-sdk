import { describe, expect, it } from "vitest";
import { preflightX402Shape } from "./preflight.js";
import type { StructuralEnvelope } from "./structural-conditions.js";

const WATCHED = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const BUYER = "GBUYER";
const SELLER = "GSELLER";
const SPONSOR = "GSPONSOR";

/** A structural fixture of a normally built Vellar payment: a sponsored
 * transfer authorized by a detached address credential, not by the fee payer.
 * This is not a signed XDR envelope. */
function normalPayment(): StructuralEnvelope {
  return {
    operations: [
      {
        type: "invoke_host_function",
        functionName: "transfer",
        contractId: WATCHED,
        args: [BUYER, SELLER, "10000000"],
        from: BUYER,
      },
    ],
    authEntries: [
      { credentialType: "sorobanCredentialsAddress", detached: true, address: BUYER },
    ],
    operationSource: SPONSOR,
    transactionSource: SPONSOR,
    feeSource: SPONSOR,
    watchedAsset: WATCHED,
  };
}

describe("preflightX402Shape (#877)", () => {
  it("passes a normally built Vellar payment before submission", () => {
    const result = preflightX402Shape(normalPayment());

    expect(result.ok).toBe(true);
    expect(result.warning).toBeUndefined();
    expect(result.classification.x402Shaped).toBe(true);
    expect(result.classification.failedConditions).toEqual([]);
  });

  it("warns with the failing condition when there is no host function call", () => {
    const envelope = normalPayment();
    envelope.operations = [];

    const result = preflightX402Shape(envelope);
    expect(result.ok).toBe(false);
    expect(result.classification.failedConditions).toContain(1);
    expect(result.warning).toContain("not be classified as x402-shaped");
    expect(result.warning).toContain("optional diagnostic");
  });

  it("warns when the transfer targets a different asset", () => {
    const envelope = normalPayment();
    envelope.operations[0]!.contractId = "CDIFFERENTASSET";

    const result = preflightX402Shape(envelope);
    expect(result.classification.failedConditions).toContain(2);
  });

  it("warns when the authorizer has no detached address credential", () => {
    const envelope = normalPayment();
    envelope.authEntries = [
      { credentialType: "sorobanCredentialsSourceAccount", detached: true, address: BUYER },
    ];

    const result = preflightX402Shape(envelope);
    expect(result.classification.failedConditions).toContain(3);
  });

  it("warns when the authorizer is also the fee source", () => {
    const envelope = normalPayment();
    envelope.feeSource = BUYER;

    const result = preflightX402Shape(envelope);
    expect(result.classification.failedConditions).toContain(4);
  });

  it("reports every failed condition in ascending order", () => {
    const result = preflightX402Shape({
      operations: [{ type: "payment" }],
      authEntries: [],
      operationSource: SPONSOR,
      transactionSource: SPONSOR,
      watchedAsset: WATCHED,
    });

    expect(result.classification.failedConditions).toEqual([1, 2, 3]);
  });
});
