import { describe, expect, it } from "vitest";
import { parseToStroops } from "./parse-to-stroops";

describe("parseToStroops", () => {
  it("converts a whole XLM amount to stroops", () => {
    expect(parseToStroops("10")).toBe(100_000_000n);
  });

  it("converts a fractional XLM amount to stroops", () => {
    expect(parseToStroops("10.5")).toBe(105_000_000n);
  });

  it("converts the smallest unit (1 stroop)", () => {
    expect(parseToStroops("0.0000001")).toBe(1n);
  });

  it("rejects an amount with more than 7 decimal places", () => {
    expect(() => parseToStroops("1.12345678")).toThrow(/at most 7 decimal places/);
  });

  it("rejects a zero amount", () => {
    expect(() => parseToStroops("0")).toThrow();
  });
});
