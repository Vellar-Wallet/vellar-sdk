import { describe, expect, it } from "vitest";
import { classifyEnforcement, enforcementLabel, stroopsToXlm } from "./policy-types";
import type { Enforcement, PolicyTemplateInfo } from "./policy-types";

function template(enforcement: Enforcement): PolicyTemplateInfo {
  return { type: "test", title: "Test", description: "A test template", enforcement };
}

describe("classifyEnforcement", () => {
  it("policy-contract is chain-enforced", () => {
    const t = template({ kind: "policy-contract", wasmHash: "abc" });
    expect(classifyEnforcement(t)).toEqual({ chainEnforced: true, explanation: "" });
  });

  it("signer-limits is chain-enforced", () => {
    const t = template({ kind: "signer-limits" });
    expect(classifyEnforcement(t)).toEqual({ chainEnforced: true, explanation: "" });
  });

  it("none is not chain-enforced with explanation", () => {
    const t = template({ kind: "none" });
    const result = classifyEnforcement(t);
    expect(result.chainEnforced).toBe(false);
    expect(result.explanation).toContain("no on-chain enforcement");
  });

  it("custom-contract-pending is not chain-enforced with explanation", () => {
    const t = template({ kind: "custom-contract-pending" });
    const result = classifyEnforcement(t);
    expect(result.chainEnforced).toBe(false);
    expect(result.explanation).toContain("not yet available");
  });
});

describe("enforcementLabel", () => {
  it("returns a label for every Enforcement variant", () => {
    const variants: Enforcement[] = [
      { kind: "policy-contract", wasmHash: "abc" },
      { kind: "signer-limits" },
      { kind: "none" },
      { kind: "custom-contract-pending" },
    ];
    for (const v of variants) {
      expect(enforcementLabel(v)).toBeTruthy();
    }
  });
});

describe("stroopsToXlm", () => {
  it("converts whole numbers", () => {
    expect(stroopsToXlm("100000000")).toBe("10");
  });

  it("converts fractional amounts", () => {
    expect(stroopsToXlm("15000000")).toBe("1.5");
  });

  it("handles zero", () => {
    expect(stroopsToXlm("0")).toBe("0");
  });
});