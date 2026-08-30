/**
 * amount-input-validator.ts
 *
 * Validates a raw string amount entered by a user before it is converted to
 * base units for a Vellar payment. Returns a structured result with a clear
 * per-rule message rather than throwing, making it easy to wire directly into
 * a form field's error state.
 *
 * Validation rules (in order):
 *  1. Non-empty after trimming
 *  2. Numeric — only digits and an optional single decimal point
 *  3. No more fractional digits than the token's `decimals` allows
 *  4. Positive (greater than zero in base units)
 *
 * The rules mirror the behaviour of `parseTokenAmount` in the SDK's
 * `src/payments.ts` so validation and parsing are always consistent.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Configuration for a specific token / asset. */
export interface TokenConfig {
  /**
   * Number of decimal places the token supports.
   * Must be a non-negative integer (e.g. 7 for XLM/stroops, 6 for USDC).
   */
  decimals: number;
  /** Optional display symbol used in error messages (e.g. "XLM", "USDC"). */
  symbol?: string;
}

/** A passing validation result. */
export interface ValidResult {
  valid: true;
  /** The validated input, trimmed. Ready to pass to `parseTokenAmount`. */
  value: string;
}

/** A failing validation result. */
export interface InvalidResult {
  valid: false;
  /** Short, user-facing error message safe to display next to the input field. */
  message: string;
  /** Machine-readable reason code for programmatic handling (e.g. highlight
   *  the decimal-places rule differently from an empty field). */
  code:
    | "EMPTY"
    | "NOT_NUMERIC"
    | "TOO_MANY_DECIMALS"
    | "ZERO"
    | "NEGATIVE"
    | "INVALID_DECIMALS_CONFIG";
}

export type ValidationResult = ValidResult | InvalidResult;

// ─────────────────────────────────────────────────────────────────────────────
// Validator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a raw amount string against the rules for a specific token.
 *
 * @param input    - The raw string the user typed (e.g. "12.50", "0", "abc").
 * @param token    - Token configuration: decimals (required) and optional symbol.
 * @returns        A `ValidResult` or `InvalidResult`.
 *
 * @example
 * const result = validateAmount("12.5", { decimals: 7, symbol: "XLM" });
 * if (!result.valid) {
 *   setFieldError(result.message);
 * } else {
 *   submitPayment(result.value); // safe to pass to parseTokenAmount
 * }
 */
export function validateAmount(input: string, token: TokenConfig): ValidationResult {
  // Guard: decimals must be a non-negative integer (matches parseTokenAmount's own guard)
  if (!Number.isInteger(token.decimals) || token.decimals < 0) {
    return {
      valid: false,
      code: "INVALID_DECIMALS_CONFIG",
      message: `Token configuration error: decimals must be a non-negative integer (got ${token.decimals}).`,
    };
  }

  const symbolSuffix = token.symbol ? ` for ${token.symbol}` : "";

  // Rule 1 — non-empty
  const trimmed = input.trim();
  if (trimmed === "") {
    return {
      valid: false,
      code: "EMPTY",
      message: "Please enter an amount.",
    };
  }

  // Rule 2 — reject explicit negatives before the numeric check so the message
  // is specific ("cannot be negative") rather than generic ("not a valid number")
  if (trimmed.startsWith("-")) {
    return {
      valid: false,
      code: "NEGATIVE",
      message: "Amount cannot be negative.",
    };
  }

  // Rule 3 — numeric: digits only, with at most one decimal point
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return {
      valid: false,
      code: "NOT_NUMERIC",
      message: `"${trimmed}" is not a valid number. Enter a positive number${symbolSuffix} (e.g. "10" or "0.5").`,
    };
  }

  // Rule 4 — decimal places
  const dotIndex = trimmed.indexOf(".");
  if (dotIndex !== -1) {
    const fractionLength = trimmed.length - dotIndex - 1;
    if (fractionLength > token.decimals) {
      const placesLabel = token.decimals === 1 ? "1 decimal place" : `${token.decimals} decimal places`;
      return {
        valid: false,
        code: "TOO_MANY_DECIMALS",
        message:
          token.decimals === 0
            ? `This token${symbolSuffix} does not support decimal amounts. Enter a whole number.`
            : `Amount supports at most ${placesLabel}${symbolSuffix}.`,
      };
    }
  }

  // Rule 5 — greater than zero in base units
  // Compute base-unit value using the same logic as parseTokenAmount so
  // inputs like "0.0000000" (7 zeros after a point, decimals=7) are caught.
  const [whole = "0", fraction = ""] = trimmed.split(".");
  const baseUnits =
    BigInt(whole) * 10n ** BigInt(token.decimals) +
    BigInt(fraction.padEnd(token.decimals, "0") || "0");

  if (baseUnits === 0n) {
    return {
      valid: false,
      code: "ZERO",
      message: `Amount must be greater than zero${symbolSuffix}.`,
    };
  }

  return { valid: true, value: trimmed };
}
