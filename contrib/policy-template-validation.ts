/**
 * Policy template fixture validation.
 *
 * Ensures that policy template fixtures used across the test suite match
 * the current PolicyTemplateInfo schema. Catches silently stale fixtures
 * when the schema evolves.
 */

import type { PolicyTemplateInfo, Enforcement } from "../src/policy-types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isEnforcement(v: unknown): v is Enforcement {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  switch (obj.kind) {
    case "policy-contract":
      return isString(obj.wasmHash);
    case "signer-limits":
    case "none":
    case "custom-contract-pending":
      return true;
    default:
      return false;
  }
}

export function validatePolicyTemplate(t: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof t !== "object" || t === null) {
    return { valid: false, errors: ["template is not an object"] };
  }
  const obj = t as Record<string, unknown>;

  if (!isString(obj.type)) errors.push("missing or non-string 'type'");
  if (!isString(obj.title)) errors.push("missing or non-string 'title'");
  if (!isString(obj.description)) errors.push("missing or non-string 'description'");
  if (!isEnforcement(obj.enforcement)) errors.push("missing or invalid 'enforcement'");

  return { valid: errors.length === 0, errors };
}

export function validatePolicyTemplates(fixtures: unknown[]): ValidationResult {
  const allErrors: string[] = [];
  for (let i = 0; i < fixtures.length; i++) {
    const result = validatePolicyTemplate(fixtures[i]);
    if (!result.valid) {
      for (const err of result.errors) {
        allErrors.push(`fixture[${i}]: ${err}`);
      }
    }
  }
  return { valid: allErrors.length === 0, errors: allErrors };
}

/** A valid policy template fixture for use in tests. */
export const VALID_SPENDING_LIMIT_TEMPLATE: PolicyTemplateInfo = {
  type: "spending_limit",
  title: "Spending limit",
  description: "Limits daily and per-transaction spending.",
  enforcement: { kind: "policy-contract", wasmHash: "ABCDEF1234567890" },
};

/** A valid policy template with signer-limits enforcement. */
export const VALID_SIGNER_LIMITS_TEMPLATE: PolicyTemplateInfo = {
  type: "signer_limits",
  title: "Signer limits",
  description: "Enforced by the smart wallet native signer limits.",
  enforcement: { kind: "signer-limits" },
};

/** A valid policy template with no enforcement. */
export const VALID_NO_ENFORCEMENT_TEMPLATE: PolicyTemplateInfo = {
  type: "default",
  title: "Default",
  description: "Default single-owner behaviour.",
  enforcement: { kind: "none" },
};
