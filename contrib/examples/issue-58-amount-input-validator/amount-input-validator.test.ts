/**
 * amount-input-validator.test.ts
 *
 * Tests for validateAmount.
 *
 * Run from the repo root:
 *   npx vitest run contrib/examples/issue-58-amount-input-validator/amount-input-validator.test.ts
 *
 * Or run the full suite:
 *   npm test
 */

import { describe, it, expect } from "vitest";
import { validateAmount } from "./amount-input-validator";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function valid(input: string, decimals: number, symbol?: string) {
  return validateAmount(input, { decimals, symbol });
}

function expectValid(input: string, decimals: number) {
  const result = validateAmount(input, { decimals });
  expect(result.valid, `expected "${input}" to be valid with decimals=${decimals}`).toBe(true);
  if (result.valid) {
    expect(result.value).toBe(input.trim());
  }
}

function expectInvalid(
  input: string,
  decimals: number,
  expectedCode: string,
) {
  const result = validateAmount(input, { decimals });
  expect(result.valid, `expected "${input}" to be invalid with decimals=${decimals}`).toBe(false);
  if (!result.valid) {
    expect(result.code).toBe(expectedCode);
    expect(result.message.length).toBeGreaterThan(0);
    // Message should never expose a raw stack trace or Error class prefix
    expect(result.message).not.toMatch(/^[A-Z][a-zA-Z]+Error:/);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Valid inputs
// ─────────────────────────────────────────────────────────────────────────────

describe("validateAmount — valid inputs", () => {
  it("whole number with 7 decimals (XLM-style)", () => expectValid("10", 7));
  it("decimal within precision (XLM-style)", () => expectValid("1.5", 7));
  it("maximum precision (7 decimal places)", () => expectValid("1.0000001", 7));
  it("large whole number", () => expectValid("999999999", 7));
  it("leading zero on decimal", () => expectValid("0.1", 7));
  it("6-decimal token (USDC-style)", () => expectValid("100.123456", 6));
  it("zero-decimal token with whole number", () => expectValid("42", 0));
  it("whitespace is trimmed and treated as valid", () => {
    const result = validateAmount("  5.5  ", { decimals: 7 });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value).toBe("5.5");
  });
  it("exact precision boundary — 6 of 6 places", () => expectValid("0.000001", 6));
  it("returns the trimmed value in result.value", () => {
    const result = valid("  3.14  ", 2);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value).toBe("3.14");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Empty / blank
// ─────────────────────────────────────────────────────────────────────────────

describe("validateAmount — empty input", () => {
  it("empty string → EMPTY", () => expectInvalid("", 7, "EMPTY"));
  it("spaces only → EMPTY", () => expectInvalid("   ", 7, "EMPTY"));
  it("tab only → EMPTY", () => expectInvalid("\t", 7, "EMPTY"));
});

// ─────────────────────────────────────────────────────────────────────────────
// Non-numeric
// ─────────────────────────────────────────────────────────────────────────────

describe("validateAmount — non-numeric input", () => {
  it("alphabetic → NOT_NUMERIC", () => expectInvalid("abc", 7, "NOT_NUMERIC"));
  it("alphanumeric mix → NOT_NUMERIC", () => expectInvalid("10abc", 7, "NOT_NUMERIC"));
  it("comma as decimal separator → NOT_NUMERIC", () => expectInvalid("1,5", 7, "NOT_NUMERIC"));
  it("multiple decimal points → NOT_NUMERIC", () => expectInvalid("1.2.3", 7, "NOT_NUMERIC"));
  it("currency symbol prefix → NOT_NUMERIC", () => expectInvalid("$10", 7, "NOT_NUMERIC"));
  it("e-notation → NOT_NUMERIC", () => expectInvalid("1e5", 7, "NOT_NUMERIC"));
  it("bare decimal point → NOT_NUMERIC", () => expectInvalid(".", 7, "NOT_NUMERIC"));
  it("trailing decimal point → NOT_NUMERIC", () => expectInvalid("10.", 7, "NOT_NUMERIC"));
  it("whitespace inside number → NOT_NUMERIC", () => expectInvalid("1 0", 7, "NOT_NUMERIC"));
});

// ─────────────────────────────────────────────────────────────────────────────
// Negative
// ─────────────────────────────────────────────────────────────────────────────

describe("validateAmount — negative input", () => {
  it("negative integer → NEGATIVE", () => expectInvalid("-1", 7, "NEGATIVE"));
  it("negative decimal → NEGATIVE", () => expectInvalid("-0.5", 7, "NEGATIVE"));
  it("negative zero → NEGATIVE", () => expectInvalid("-0", 7, "NEGATIVE"));
  it("message does not say NOT_NUMERIC for negatives", () => {
    const result = validateAmount("-5", { decimals: 7 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("NEGATIVE");
      expect(result.message.toLowerCase()).toContain("negative");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Zero
// ─────────────────────────────────────────────────────────────────────────────

describe("validateAmount — zero input", () => {
  it("literal zero → ZERO", () => expectInvalid("0", 7, "ZERO"));
  it("0.0 → ZERO", () => expectInvalid("0.0", 7, "ZERO"));
  it("all-zero fractional (max decimals) → ZERO", () => expectInvalid("0.0000000", 7, "ZERO"));
  it("0.000000 for 6-decimal token → ZERO", () => expectInvalid("0.000000", 6, "ZERO"));
  it("zero-decimal token with 0 → ZERO", () => expectInvalid("0", 0, "ZERO"));
});

// ─────────────────────────────────────────────────────────────────────────────
// Too many decimal places
// ─────────────────────────────────────────────────────────────────────────────

describe("validateAmount — too many decimal places", () => {
  it("8 decimal places on a 7-decimal token → TOO_MANY_DECIMALS", () =>
    expectInvalid("1.00000001", 7, "TOO_MANY_DECIMALS"));

  it("7 decimal places on a 6-decimal token → TOO_MANY_DECIMALS", () =>
    expectInvalid("1.0000001", 6, "TOO_MANY_DECIMALS"));

  it("any decimal on a 0-decimal token → TOO_MANY_DECIMALS", () =>
    expectInvalid("1.1", 0, "TOO_MANY_DECIMALS"));

  it("message mentions 'decimal' for 0-decimal token", () => {
    const result = validateAmount("1.5", { decimals: 0, symbol: "NODEC" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("TOO_MANY_DECIMALS");
      expect(result.message.toLowerCase()).toContain("decimal");
    }
  });

  it("message mentions the symbol when provided", () => {
    const result = validateAmount("1.00000001", { decimals: 7, symbol: "XLM" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.message).toContain("XLM");
    }
  });

  it("exactly at precision boundary is valid (not TOO_MANY_DECIMALS)", () =>
    expectValid("1.0000001", 7));
});

// ─────────────────────────────────────────────────────────────────────────────
// Invalid token config
// ─────────────────────────────────────────────────────────────────────────────

describe("validateAmount — invalid token config", () => {
  it("negative decimals → INVALID_DECIMALS_CONFIG", () =>
    expectInvalid("1", -1, "INVALID_DECIMALS_CONFIG"));

  it("fractional decimals → INVALID_DECIMALS_CONFIG", () => {
    const result = validateAmount("1", { decimals: 2.5 });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("INVALID_DECIMALS_CONFIG");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Symbol in error messages
// ─────────────────────────────────────────────────────────────────────────────

describe("validateAmount — symbol in error messages", () => {
  it("ZERO message includes symbol", () => {
    const result = validateAmount("0", { decimals: 7, symbol: "XLM" });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.message).toContain("XLM");
  });

  it("NOT_NUMERIC message includes symbol", () => {
    const result = validateAmount("abc", { decimals: 7, symbol: "USDC" });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.message).toContain("USDC");
  });

  it("no symbol → message still valid and non-empty", () => {
    const result = validateAmount("0", { decimals: 7 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.message.length).toBeGreaterThan(0);
    }
  });
});
