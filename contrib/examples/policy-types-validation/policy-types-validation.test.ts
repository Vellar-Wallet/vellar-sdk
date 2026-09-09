import { describe, it, expect } from "vitest";
import { validatePolicyDefinition } from "./policy-types-validation";

describe("Issue #264 — Policy-types schema validation", () => {
  it("validates a well-formed policy definition", () => {
    const validDef = {
      version: "1.0",
      type: "spending-limit",
      owners: ["alice", "bob"],
      threshold: 2,
      spendingLimits: { dailyXlm: "100" },
    };
    expect(validatePolicyDefinition(validDef)).toEqual({ valid: true, errors: [] });
  });

  it("fails when required fields are missing", () => {
    const invalidDef = { owners: ["alice"] };
    const result = validatePolicyDefinition(invalidDef);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Invalid or missing version");
    expect(result.errors).toContain("Invalid or missing type");
  });

  it("fails on invalid type and out-of-range values", () => {
    const outOfRange = {
      version: "1.0",
      type: "spending-limit",
      owners: ["alice"],
      threshold: 5, // out of range
    };
    const result = validatePolicyDefinition(outOfRange);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Threshold must be a number between 1 and the number of owners");
  });

  it("validates nested policy rule validation", () => {
    const badNested = {
      version: "1.0",
      type: "spending-limit",
      owners: ["alice"],
      spendingLimits: { dailyXlm: 100 }, // should be string
      timelocks: { adminActionDelaySeconds: "10" }, // should be number
      allowlistedContracts: [123], // should be string
    };
    const result = validatePolicyDefinition(badNested);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("dailyXlm must be a string");
    expect(result.errors).toContain("adminActionDelaySeconds must be a number");
    expect(result.errors).toContain("allowlistedContracts must be an array of strings");
  });
});
