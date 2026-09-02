import { describe, expect, it } from "vitest";
import {
  SpendingConstructor,
  VerifiedRecipientConstructor,
  Enforcement,
  PolicyTemplateInfo,
  ValidationResult,
  GeneratedPolicy,
  SimulateResult,
  DeployPolicyResult,
  enforcementLabel,
  stroopsToXlm,
  PolicyApiError,
} from "./policy-types";

function spending(dailyLimitStroops = "1000000", windowSeconds = 86400): SpendingConstructor {
  return { dailyLimitStroops, windowSeconds };
}

function verifiedRecipient(registry = "registry.example"): VerifiedRecipientConstructor {
  return { registry };
}

describe("SpendingConstructor", () => {
  it("accepts valid dailyLimitStroops and windowSeconds", () => {
    const s: SpendingConstructor = spending();
    expect(s.dailyLimitStroops).toBe("1000000");
    expect(s.windowSeconds).toBe(86400);
  });

  it("accepts custom dailyLimitStroops", () => {
    const s: SpendingConstructor = { dailyLimitStroops: "5000000", windowSeconds: 3600 };
    expect(s.dailyLimitStroops).toBe("5000000");
    expect(s.windowSeconds).toBe(3600);
  });

  it("accepts windowSeconds of 0", () => {
    const s: SpendingConstructor = { dailyLimitStroops: "100", windowSeconds: 0 };
    expect(s.windowSeconds).toBe(0);
  });

  it("accepts large windowSeconds value", () => {
    const s: SpendingConstructor = { dailyLimitStroops: "1000000", windowSeconds: 999999999 };
    expect(s.windowSeconds).toBe(999999999);
  });

  it("accepts empty string dailyLimitStroops", () => {
    const s: SpendingConstructor = { dailyLimitStroops: "", windowSeconds: 86400 };
    expect(s.dailyLimitStroops).toBe("");
  });
});

describe("VerifiedRecipientConstructor", () => {
  it("accepts valid registry", () => {
    const v: VerifiedRecipientConstructor = verifiedRecipient();
    expect(v.registry).toBe("registry.example");
  });

  it("accepts custom registry", () => {
    const v: VerifiedRecipientConstructor = { registry: "my-registry.stellar" };
    expect(v.registry).toBe("my-registry.stellar");
  });

  it("accepts registry with subdomain", () => {
    const v: VerifiedRecipientConstructor = { registry: "sub.registry.example" };
    expect(v.registry).toBe("sub.registry.example");
  });

  it("accepts registry with numeric characters", () => {
    const v: VerifiedRecipientConstructor = { registry: "registry123.example" };
    expect(v.registry).toBe("registry123.example");
  });
});

describe("Enforcement", () => {
  it("accepts policy-contract kind", () => {
    const e: Enforcement = { kind: "policy-contract", wasmHash: "abc123" };
    expect(e.kind).toBe("policy-contract");
  });

  it("accepts policy-contract with constructorArgs", () => {
    const e: Enforcement = {
      kind: "policy-contract",
      wasmHash: "abc123",
      constructorArgs: spending(),
    };
    expect(e.constructorArgs?.dailyLimitStroops).toBe("1000000");
  });

  it("accepts signer-limits kind", () => {
    const e: Enforcement = { kind: "signer-limits" };
    expect(e.kind).toBe("signer-limits");
  });

  it("accepts none kind", () => {
    const e: Enforcement = { kind: "none" };
    expect(e.kind).toBe("none");
  });

  it("accepts custom-contract-pending kind", () => {
    const e: Enforcement = { kind: "custom-contract-pending" };
    expect(e.kind).toBe("custom-contract-pending");
  });
});

describe("PolicyTemplateInfo", () => {
  it("accepts valid template info", () => {
    const t: PolicyTemplateInfo = {
      type: "spending",
      title: "Daily Spend Limit",
      description: "A daily spending limit policy",
      enforcement: { kind: "policy-contract", wasmHash: "abc123" },
    };
    expect(t.type).toBe("spending");
    expect(t.title).toBe("Daily Spend Limit");
    expect(t.description).toBe("A daily spending limit policy");
  });
});

describe("ValidationResult", () => {
  it("accepts valid result", () => {
    const v: ValidationResult = { valid: true, errors: [] };
    expect(v.valid).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it("accepts invalid result with errors", () => {
    const v: ValidationResult = { valid: false, errors: ["err1", "err2"] };
    expect(v.valid).toBe(false);
    expect(v.errors).toEqual(["err1", "err2"]);
  });
});

describe("GeneratedPolicy", () => {
  it("accepts valid generated policy", () => {
    const g: GeneratedPolicy = {
      id: "p1",
      createdAt: "2024-01-01T00:00:00Z",
      status: "generated",
      definition: { type: "spending", title: "Test", description: "Desc", enforcement: { kind: "none" } },
      policyHash: "hash123",
      manifest: { template: "spending", enforcement: { kind: "none" }, network: "testnet" },
    };
    expect(g.id).toBe("p1");
    expect(g.status).toBe("generated");
  });
});

describe("SimulateResult", () => {
  it("accepts valid simulate result", () => {
    const s: SimulateResult = { ok: true, minResourceFee: "100" };
    expect(s.ok).toBe(true);
    expect(s.minResourceFee).toBe("100");
  });

  it("accepts simulate result with error", () => {
    const s: SimulateResult = { ok: false, error: "insufficient funds" };
    expect(s.ok).toBe(false);
    expect(s.error).toBe("insufficient funds");
  });
});

describe("DeployPolicyResult", () => {
  it("accepts valid deploy result", () => {
    const d: DeployPolicyResult = {
      policy: {
        id: "p1",
        createdAt: "2024-01-01T00:00:00Z",
        status: "generated",
        definition: { type: "spending", title: "Test", description: "Desc", enforcement: { kind: "none" } },
        policyHash: "hash123",
        manifest: { template: "spending", enforcement: { kind: "none" }, network: "testnet" },
      },
      contractId: "C123",
      attachTxHash: "tx123",
    };
    expect(d.policy.id).toBe("p1");
    expect(d.contractId).toBe("C123");
    expect(d.attachTxHash).toBe("tx123");
  });
});

describe("enforcementLabel", () => {
  it("returns correct label for policy-contract", () => {
    const label = enforcementLabel({ kind: "policy-contract", wasmHash: "abc" });
    expect(label).toContain("Enforced on-chain");
  });

  it("returns correct label for signer-limits", () => {
    const label = enforcementLabel({ kind: "signer-limits" });
    expect(label).toContain("Enforced by the smart wallet's native signer limits");
  });

  it("returns correct label for none", () => {
    const label = enforcementLabel({ kind: "none" });
    expect(label).toContain("Default single-owner behaviour");
  });

  it("returns correct label for custom-contract-pending", () => {
    const label = enforcementLabel({ kind: "custom-contract-pending" });
    expect(label).toContain("Requires a custom policy contract");
  });
});

describe("stroopsToXlm", () => {
  it("formats stroops as XLM string", () => {
    expect(stroopsToXlm("1000000000")).toBe("100");
  });

  it("formats stroops with fractional part", () => {
    expect(stroopsToXlm("1000000500")).toBe("100.00005");
  });

  it("formats round stroops without fractional part", () => {
    expect(stroopsToXlm("100000000")).toBe("10");
  });
});

describe("PolicyApiError", () => {
  it("creates error with retryable true for 5xx", () => {
    const e = new PolicyApiError("msg", 500);
    expect(e.status).toBe(500);
    expect(e.retryable).toBe(true);
    expect(e.errors).toBeUndefined();
  });

  it("creates error with retryable true for 408", () => {
    const e = new PolicyApiError("msg", 408);
    expect(e.retryable).toBe(true);
  });

  it("creates error with retryable true for 429", () => {
    const e = new PolicyApiError("msg", 429);
    expect(e.retryable).toBe(true);
  });

  it("creates error with retryable false for 400", () => {
    const e = new PolicyApiError("msg", 400);
    expect(e.retryable).toBe(false);
  });

  it("creates error with retryable false for 200", () => {
    const e = new PolicyApiError("msg", 200);
    expect(e.retryable).toBe(false);
  });

  it("includes errors array when provided", () => {
    const e = new PolicyApiError("msg", 422, ["mismatch"]);
    expect(e.errors).toEqual(["mismatch"]);
  });

  it("includes status and message", () => {
    const e = new PolicyApiError("deploy failed", 403);
    expect(e.message).toBe("deploy failed");
    expect(e.status).toBe(403);
  });
});