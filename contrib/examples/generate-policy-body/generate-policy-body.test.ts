import { describe, expect, it } from "vitest";
import { buildSpendingPolicyBody } from "./generate-policy-body";

describe("buildSpendingPolicyBody", () => {
  it("builds a spending-limit body from a limit and window", () => {
    expect(buildSpendingPolicyBody("1000000000", "86400")).toEqual({
      type: "spending-limit",
      constructorArgs: {
        dailyLimitStroops: "1000000000",
        windowSeconds: 86400,
      },
    });
  });

  it("rejects a non-positive limit", () => {
    expect(() => buildSpendingPolicyBody("0", "86400")).toThrow(RangeError);
    expect(() => buildSpendingPolicyBody("-5", "86400")).toThrow(RangeError);
  });

  it("rejects a non-positive window", () => {
    expect(() => buildSpendingPolicyBody("1000000000", "0")).toThrow(RangeError);
  });

  it("rejects a non-numeric argument", () => {
    expect(() => buildSpendingPolicyBody("abc", "86400")).toThrow(RangeError);
    expect(() => buildSpendingPolicyBody("1000000000", "abc")).toThrow(RangeError);
  });
});
