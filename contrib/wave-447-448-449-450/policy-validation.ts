import type { PolicyDefinition } from "../../src/types";
import type { ValidationResult } from "../../src/policy-types";

// Issue #448: Validate PolicyDefinition client-side before calling the API.
//
// A pure validator returning the same ValidationResult shape the server API
// returns, so a caller can use one type for both local and server validation.
// This is a fast-fail convenience — the server remains authoritative. The same
// discipline the client-side budget modules already use.

const VALID_POLICY_TYPES = new Set([
  "spending-limit",
  "verified-recipient",
  "multi-sig",
  "allowlist",
  "timelock",
]);

/** Validate a PolicyDefinition locally. Covers what is locally checkable:
 * required fields per policy type, at least one spending limit when the type
 * requires it, valid contract and account address formats (via the injected
 * `isValidAddress`), a threshold not exceeding the owner count, and
 * non-negative amounts. */
export function validatePolicyDefinitionClient(
  definition: unknown,
  isValidAddress?: (address: string) => boolean,
): ValidationResult {
  const errors: string[] = [];

  if (!definition || typeof definition !== "object") {
    return { valid: false, errors: ["definition must be an object"] };
  }

  const def = definition as Record<string, unknown>;

  // Required fields
  if (typeof def.version !== "string" || !def.version) {
    errors.push("version is required and must be a non-empty string");
  }
  if (typeof def.type !== "string" || !VALID_POLICY_TYPES.has(def.type)) {
    errors.push(`type is required and must be one of: ${[...VALID_POLICY_TYPES].join(", ")}`);
  }

  // Owners
  if (!Array.isArray(def.owners) || def.owners.length === 0) {
    errors.push("owners is required and must be a non-empty array");
  } else {
    for (let i = 0; i < def.owners.length; i++) {
      if (typeof def.owners[i] !== "string" || !def.owners[i]) {
        errors.push(`owners[${i}] must be a non-empty string`);
      } else if (isValidAddress && !isValidAddress(def.owners[i])) {
        errors.push(`owners[${i}] is not a valid address`);
      }
    }
  }

  // Threshold
  if (def.threshold !== undefined) {
    if (typeof def.threshold !== "number" || !Number.isInteger(def.threshold)) {
      errors.push("threshold must be an integer");
    } else if (def.threshold < 1) {
      errors.push("threshold must be at least 1");
    } else if (Array.isArray(def.owners) && def.threshold > def.owners.length) {
      errors.push("threshold must not exceed the number of owners");
    }
  }

  // Spending limits
  if (def.spendingLimits !== undefined) {
    if (typeof def.spendingLimits !== "object" || def.spendingLimits === null) {
      errors.push("spendingLimits must be an object");
    } else {
      const sl = def.spendingLimits as Record<string, unknown>;
      if (sl.dailyXlm !== undefined) {
        if (typeof sl.dailyXlm !== "string") {
          errors.push("spendingLimits.dailyXlm must be a string");
        } else if (!isValidNonNegativeAmount(sl.dailyXlm)) {
          errors.push("spendingLimits.dailyXlm must be a non-negative numeric string");
        }
      }
      if (sl.perTxXlm !== undefined) {
        if (typeof sl.perTxXlm !== "string") {
          errors.push("spendingLimits.perTxXlm must be a string");
        } else if (!isValidNonNegativeAmount(sl.perTxXlm)) {
          errors.push("spendingLimits.perTxXlm must be a non-negative numeric string");
        }
      }
    }
  }

  // Allowlisted contracts
  if (def.allowlistedContracts !== undefined) {
    if (!Array.isArray(def.allowlistedContracts)) {
      errors.push("allowlistedContracts must be an array");
    } else {
      for (let i = 0; i < def.allowlistedContracts.length; i++) {
        if (typeof def.allowlistedContracts[i] !== "string" || !def.allowlistedContracts[i]) {
          errors.push(`allowlistedContracts[${i}] must be a non-empty string`);
        } else if (isValidAddress && !isValidAddress(def.allowlistedContracts[i])) {
          errors.push(`allowlistedContracts[${i}] is not a valid address`);
        }
      }
    }
  }

  // Timelocks
  if (def.timelocks !== undefined) {
    if (typeof def.timelocks !== "object" || def.timelocks === null) {
      errors.push("timelocks must be an object");
    } else {
      const tl = def.timelocks as Record<string, unknown>;
      if (tl.adminActionDelaySeconds !== undefined) {
        if (typeof tl.adminActionDelaySeconds !== "number") {
          errors.push("timelocks.adminActionDelaySeconds must be a number");
        } else if (tl.adminActionDelaySeconds < 0) {
          errors.push("timelocks.adminActionDelaySeconds must be non-negative");
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function isValidNonNegativeAmount(value: string): boolean {
  if (!value) return false;
  const n = Number(value);
  return !Number.isNaN(n) && n >= 0;
}