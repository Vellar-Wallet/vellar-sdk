import { describe, expect, it } from "vitest";
import {
  PolicyApiError,
  enforcementLabel,
  stroopsToXlm,
  type Enforcement,
} from "../src/policy-types";

describe("enforcementLabel", () => {
  it.each<[Enforcement["kind"], Enforcement, RegExp]>([
    ["policy-contract", { kind: "policy-contract", wasmHash: "abc" }, /dedicated policy contract/],
    ["signer-limits", { kind: "signer-limits" }, /native signer limits/],
    ["none", { kind: "none" }, /no extra on-chain enforcement/],
    ["custom-contract-pending", { kind: "custom-contract-pending" }, /custom policy contract/],
  ])("labels %s", (_kind, enforcement, pattern) => {
    expect(enforcementLabel(enforcement)).toMatch(pattern);
  });

  it("gives each kind a distinct label", () => {
    const labels = [
      enforcementLabel({ kind: "policy-contract", wasmHash: "abc" }),
      enforcementLabel({ kind: "signer-limits" }),
      enforcementLabel({ kind: "none" }),
      enforcementLabel({ kind: "custom-contract-pending" }),
    ];
    expect(new Set(labels).size).toBe(4);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["missing kind", {}],
    ["empty kind", { kind: "" }],
    ["unknown kind", { kind: "anything" }],
    ["wrong-type kind", { kind: 1 }],
  ])("returns no label for malformed input: %s", (_label, value) => {
    // A malformed enforcement must never be presented as a real trust claim.
    let label: unknown;
    try {
      label = enforcementLabel(value as unknown as Enforcement);
    } catch {
      return; // throwing is an acceptable rejection
    }
    expect(label).toBeUndefined();
  });
});

describe("stroopsToXlm", () => {
  it.each([
    ["0", "0"],
    ["1", "0.0000001"],
    ["10000000", "1"],
    ["15000000", "1.5"],
    ["1000000000", "100"],
    ["10000001", "1.0000001"],
    ["123456789012", "12345.6789012"],
  ])("formats %s stroops as %s XLM", (stroops, xlm) => {
    expect(stroopsToXlm(stroops)).toBe(xlm);
  });

  it.each([
    ["non-numeric", "abc"],
    ["decimal", "1.5"],
    ["exponent", "1e7"],
    ["null", null],
    ["undefined", undefined],
    ["object", {}],
  ])("rejects %s", (_label, value) => {
    expect(() => stroopsToXlm(value as unknown as string)).toThrow();
  });
});

describe("stroopsToXlm known gap", () => {
  // BigInt("") and BigInt("  ") are 0n, so blank input is silently accepted as
  // zero rather than rejected. Pinned here so a future stricter core is a
  // deliberate change, not a surprise.
  it.each([["empty string", ""], ["whitespace", "  "]])("accepts %s as 0", (_label, value) => {
    expect(stroopsToXlm(value)).toBe("0");
  });
});

describe("PolicyApiError", () => {
  it("carries name, message, status and errors", () => {
    const err = new PolicyApiError("nope", 422, ["bad"]);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PolicyApiError");
    expect(err.message).toBe("nope");
    expect(err.status).toBe(422);
    expect(err.errors).toEqual(["bad"]);
  });

  it("leaves errors undefined when none are given", () => {
    expect(new PolicyApiError("x", 500).errors).toBeUndefined();
  });

  it.each([0, 408, 429, 500, 502, 503, 504, 599])("status %i is retryable", (status) => {
    expect(new PolicyApiError("x", status).retryable).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 410, 422, 499])("status %i is terminal", (status) => {
    expect(new PolicyApiError("x", status).retryable).toBe(false);
  });

  it.each([200, 201, 204, 301, 302])("non-error status %i is not retryable", (status) => {
    expect(new PolicyApiError("x", status).retryable).toBe(false);
  });

  it("treats attach_unconfirmed (503) as retry and attach_mismatch (422) as do-not-retry", () => {
    expect(new PolicyApiError("attach_unconfirmed", 503).retryable).toBe(true);
    expect(new PolicyApiError("attach_mismatch", 422).retryable).toBe(false);
  });
});
