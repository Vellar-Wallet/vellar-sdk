import type { PolicyDefinition } from "../../../src/types";
import type { ValidationResult } from "../../../src/policy-types";

/**
 * Issue #264: Policy-types schema validation
 */
export function validatePolicyDefinition(def: any): ValidationResult {
  const errors: string[] = [];

  if (!def || typeof def !== "object") {
    return { valid: false, errors: ["Policy definition must be an object"] };
  }
  
  if (typeof def.version !== "string") {
    errors.push("Invalid or missing version");
  }
  if (typeof def.type !== "string") {
    errors.push("Invalid or missing type");
  }
  
  if (!Array.isArray(def.owners) || def.owners.length === 0) {
    errors.push("Owners must be a non-empty array");
  } else if (!def.owners.every((o: any) => typeof o === "string")) {
    errors.push("All owners must be strings");
  }

  if (def.threshold !== undefined) {
    if (typeof def.threshold !== "number" || def.threshold < 1 || (Array.isArray(def.owners) && def.threshold > def.owners.length)) {
      errors.push("Threshold must be a number between 1 and the number of owners");
    }
  }

  if (def.spendingLimits !== undefined) {
    if (typeof def.spendingLimits !== "object") {
      errors.push("spendingLimits must be an object");
    } else {
      if (def.spendingLimits.dailyXlm !== undefined && typeof def.spendingLimits.dailyXlm !== "string") {
        errors.push("dailyXlm must be a string");
      }
      if (def.spendingLimits.perTxXlm !== undefined && typeof def.spendingLimits.perTxXlm !== "string") {
        errors.push("perTxXlm must be a string");
      }
    }
  }

  if (def.allowlistedContracts !== undefined) {
    if (!Array.isArray(def.allowlistedContracts) || !def.allowlistedContracts.every((c: any) => typeof c === "string")) {
      errors.push("allowlistedContracts must be an array of strings");
    }
  }

  if (def.timelocks !== undefined) {
    if (typeof def.timelocks !== "object") {
      errors.push("timelocks must be an object");
    } else if (def.timelocks.adminActionDelaySeconds !== undefined && typeof def.timelocks.adminActionDelaySeconds !== "number") {
      errors.push("adminActionDelaySeconds must be a number");
    }
  }

  return { valid: errors.length === 0, errors };
}
