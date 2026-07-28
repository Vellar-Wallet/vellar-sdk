import { describe, expect, it } from "vitest";
import { FEE_TABLE, recommendFeeOption } from "./fee-comparison-tool";

describe("recommendFeeOption", () => {
  it("recommends the cheapest option that meets a generous deadline", () => {
    const result = recommendFeeOption(600);
    expect(result.recommended?.priority).toBe("low");
    expect(result.eligibleOptions.map((o) => o.priority)).toEqual(["low", "medium", "high"]);
  });

  it("excludes options that miss a tighter deadline and recommends the cheapest remaining one", () => {
    const result = recommendFeeOption(120);
    expect(result.eligibleOptions.map((o) => o.priority)).toEqual(["medium", "high"]);
    expect(result.recommended?.priority).toBe("medium");
  });

  it("recommends the only option meeting a very tight deadline", () => {
    const result = recommendFeeOption(10);
    expect(result.eligibleOptions.map((o) => o.priority)).toEqual(["high"]);
    expect(result.recommended?.priority).toBe("high");
  });

  it("returns a null recommendation with a reason when no option meets the deadline", () => {
    const result = recommendFeeOption(1);
    expect(result.recommended).toBeNull();
    expect(result.eligibleOptions).toEqual([]);
    expect(result.reasoning).toMatch(/No priority level confirms within 1s/);
  });

  it("does not mutate the default FEE_TABLE export", () => {
    const before = FEE_TABLE.map((o) => ({ ...o }));
    recommendFeeOption(60);
    expect(FEE_TABLE).toEqual(before);
  });

  it("accepts a custom fee table instead of the default one", () => {
    const customTable = [
      { priority: "low" as const, feeStroops: 50n, estimatedConfirmationSeconds: 400 },
      { priority: "high" as const, feeStroops: 900n, estimatedConfirmationSeconds: 20 },
    ];
    const result = recommendFeeOption(30, customTable);
    expect(result.recommended?.priority).toBe("high");
  });
});
