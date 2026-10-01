import { describe, expect, it } from "vitest";
import { validatePolicyDefinitionClient } from "./policy-validation";

const validDef = {
  version: "1.0",
  type: "spending-limit",
  owners: ["CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"],
  threshold: 1,
  spendingLimits: { dailyXlm: "100" },
};

describe("validatePolicyDefinitionClient (#448)", () => {
  it("accepts a well-formed definition", () => {
    expect(validatePolicyDefinitionClient(validDef)).toEqual({ valid: true, errors: [] });
  });

  it("requires version", () => {
    const { valid, errors } = validatePolicyDefinitionClient({ ...validDef, version: undefined });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes("version"))).toBe(true);
  });

  it("requires type", () => {
    const { valid, errors } = validatePolicyDefinitionClient({ ...validDef, type: undefined });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes("type"))).toBe(true);
  });

  it("rejects unknown policy type", () => {
    const { valid, errors } = validatePolicyDefinitionClient({ ...validDef, type: "bogus" });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes("type"))).toBe(true);
  });

  it("requires non-empty owners", () => {
    const { valid, errors } = validatePolicyDefinitionClient({ ...validDef, owners: [] });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes("owners"))).toBe(true);
  });

  it("rejects threshold exceeding owner count", () => {
    const { valid, errors } = validatePolicyDefinitionClient({
      ...validDef,
      owners: ["CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4"],
      threshold: 2,
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes("threshold"))).toBe(true);
  });

  it("accepts threshold exactly equal to owner count", () => {
    const result = validatePolicyDefinitionClient({
      ...validDef,
      owners: [
        "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
        "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC5",
      ],
      threshold: 2,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects threshold below 1", () => {
    const { valid, errors } = validatePolicyDefinitionClient({ ...validDef, threshold: 0 });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes("threshold"))).toBe(true);
  });

  it("rejects non-integer threshold", () => {
    const { valid, errors } = validatePolicyDefinitionClient({ ...validDef, threshold: 1.5 });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes("threshold"))).toBe(true);
  });

  it("rejects negative dailyXlm", () => {
    const { valid, errors } = validatePolicyDefinitionClient({
      ...validDef,
      spendingLimits: { dailyXlm: "-1" },
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes("dailyXlm"))).toBe(true);
  });

  it("rejects non-string dailyXlm", () => {
    const { valid, errors } = validatePolicyDefinitionClient({
      ...validDef,
      spendingLimits: { dailyXlm: 100 },
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes("dailyXlm"))).toBe(true);
  });

  it("rejects negative perTxXlm", () => {
    const { valid, errors } = validatePolicyDefinitionClient({
      ...validDef,
      spendingLimits: { perTxXlm: "-5" },
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes("perTxXlm"))).toBe(true);
  });

  it("rejects non-string allowlistedContracts entries", () => {
    const { valid, errors } = validatePolicyDefinitionClient({
      ...validDef,
      allowlistedContracts: [123],
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes("allowlistedContracts"))).toBe(true);
  });

  it("rejects non-number adminActionDelaySeconds", () => {
    const { valid, errors } = validatePolicyDefinitionClient({
      ...validDef,
      timelocks: { adminActionDelaySeconds: "10" },
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes("adminActionDelaySeconds"))).toBe(true);
  });

  it("rejects negative adminActionDelaySeconds", () => {
    const { valid, errors } = validatePolicyDefinitionClient({
      ...validDef,
      timelocks: { adminActionDelaySeconds: -1 },
    });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes("adminActionDelaySeconds"))).toBe(true);
  });

  it("validates addresses when isValidAddress is provided", () => {
    const isValidAddress = (addr: string) => addr.startsWith("C");
    const { valid, errors } = validatePolicyDefinitionClient(
      { ...validDef, owners: ["INVALID"] },
      isValidAddress,
    );
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes("valid address"))).toBe(true);
  });

  it("validates allowlisted contract addresses when isValidAddress is provided", () => {
    const isValidAddress = (addr: string) => addr.startsWith("C");
    const { valid, errors } = validatePolicyDefinitionClient(
      { ...validDef, allowlistedContracts: ["INVALID"] },
      isValidAddress,
    );
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes("valid address"))).toBe(true);
  });

  it("rejects null input", () => {
    const { valid, errors } = validatePolicyDefinitionClient(null);
    expect(valid).toBe(false);
    expect(errors).toContain("definition must be an object");
  });

  it("collects multiple errors", () => {
    const { valid, errors } = validatePolicyDefinitionClient({ owners: [] });
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});