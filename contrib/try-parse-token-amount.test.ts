import { describe, expect, it } from "vitest";
import { tryParseTokenAmount } from "./try-parse-token-amount";

describe("tryParseTokenAmount", () => {
  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["abc", "not-a-number"],
    ["1.2.3", "not-a-number"],
    ["-5", "negative"],
    ["1.00000001", "too-many-decimals"],
    ["0", "zero"],
  ] as const)("returns the correct reason for %j", (input, reason) => {
    expect(tryParseTokenAmount(input, 7)).toMatchObject({
      ok: false,
      reason,
    });
  });

  it("accepts a value at the token precision boundary", () => {
    expect(tryParseTokenAmount("1.0000001", 7)).toEqual({
      ok: true,
      value: 10000001n,
    });
  });

  it("rejects invalid decimal configuration", () => {
    expect(() => tryParseTokenAmount("1", -1)).toThrow(RangeError);
  });
});