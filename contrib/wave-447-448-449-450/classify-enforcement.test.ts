import { describe, expect, it } from "vitest";
import { classifyEnforcement } from "./classify-enforcement";
import type { Enforcement, PolicyTemplateInfo } from "../../src/policy-types";

function template(enforcement: Enforcement): PolicyTemplateInfo {
  return { type: "test", title: "Test", description: "A test template", enforcement };
}

describe("classifyEnforcement (#449)", () => {
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

  it("all four Enforcement variants are covered", () => {
    const variants: Enforcement[] = [
      { kind: "policy-contract", wasmHash: "abc" },
      { kind: "signer-limits" },
      { kind: "none" },
      { kind: "custom-contract-pending" },
    ];
    for (const v of variants) {
      const result = classifyEnforcement(template(v));
      expect(typeof result.chainEnforced).toBe("boolean");
      expect(typeof result.explanation).toBe("string");
    }
  });
});