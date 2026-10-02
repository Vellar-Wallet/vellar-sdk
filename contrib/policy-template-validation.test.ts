import { describe, expect, it } from "vitest";
import {
  validatePolicyTemplate,
  validatePolicyTemplates,
  VALID_SPENDING_LIMIT_TEMPLATE,
  VALID_SIGNER_LIMITS_TEMPLATE,
  VALID_NO_ENFORCEMENT_TEMPLATE,
} from "./policy-template-validation";

describe("validatePolicyTemplate", () => {
  it("accepts a valid spending_limit template", () => {
    expect(validatePolicyTemplate(VALID_SPENDING_LIMIT_TEMPLATE)).toEqual({ valid: true, errors: [] });
  });

  it("accepts a valid signer-limits template", () => {
    expect(validatePolicyTemplate(VALID_SIGNER_LIMITS_TEMPLATE)).toEqual({ valid: true, errors: [] });
  });

  it("accepts a valid no-enforcement template", () => {
    expect(validatePolicyTemplate(VALID_NO_ENFORCEMENT_TEMPLATE)).toEqual({ valid: true, errors: [] });
  });

  it("rejects non-object input", () => {
    const result = validatePolicyTemplate(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("template is not an object");
  });

  it("rejects template with missing type", () => {
    const result = validatePolicyTemplate({ title: "x", description: "y", enforcement: { kind: "none" } });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("missing or non-string 'type'");
  });

  it("rejects template with invalid enforcement", () => {
    const result = validatePolicyTemplate({
      type: "spending_limit",
      title: "x",
      description: "y",
      enforcement: { kind: "unknown_kind" },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("missing or invalid 'enforcement'");
  });

  it("rejects policy-contract enforcement without wasmHash", () => {
    const result = validatePolicyTemplate({
      type: "spending_limit",
      title: "x",
      description: "y",
      enforcement: { kind: "policy-contract" },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("missing or invalid 'enforcement'");
  });
});

describe("validatePolicyTemplates (batch)", () => {
  it("validates a list of good fixtures", () => {
    const result = validatePolicyTemplates([
      VALID_SPENDING_LIMIT_TEMPLATE,
      VALID_SIGNER_LIMITS_TEMPLATE,
      VALID_NO_ENFORCEMENT_TEMPLATE,
    ]);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("detects an invalid fixture in a batch", () => {
    const result = validatePolicyTemplates([
      VALID_SPENDING_LIMIT_TEMPLATE,
      { type: 123, title: null, description: true, enforcement: "bad" },
      VALID_NO_ENFORCEMENT_TEMPLATE,
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/^fixture\[1\]/);
  });

  it("reports multiple invalid fixtures", () => {
    const result = validatePolicyTemplates([{}, null, { type: "ok", title: "ok", description: "ok", enforcement: { kind: "none" } }]);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.errors[0]).toMatch(/^fixture\[0\]/);
    expect(result.errors.some((e) => e.startsWith("fixture[1]"))).toBe(true);
  });
});
