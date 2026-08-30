import { describe, expect, it } from "vitest";
import { recommendSpendingLimit } from "./policy-limit-recommender";

describe("recommendSpendingLimit", () => {
  it("uses the 90th percentile with 1.5x headroom by default", () => {
    const amounts = [12, 8, 45, 15, 9, 60, 11, 14, 10, 13]; // sorted: 8 9 10 11 12 13 14 15 45 60
    const result = recommendSpendingLimit(amounts);
    expect(result.percentile).toBe(90);
    expect(result.percentileValue).toBe(45); // rank = ceil(0.9*10) = 9 -> index 8 -> 45
    expect(result.headroomMultiplier).toBe(1.5);
    expect(result.recommendedLimit).toBe(67.5);
    expect(result.sampleSize).toBe(10);
  });

  it("honors a custom percentile", () => {
    const amounts = [10, 20, 30, 40, 50];
    const result = recommendSpendingLimit(amounts, { percentile: 50 });
    expect(result.percentileValue).toBe(30); // rank = ceil(0.5*5) = 3 -> index 2 -> 30
  });

  it("honors a custom headroom multiplier", () => {
    const amounts = [100];
    const result = recommendSpendingLimit(amounts, { headroomMultiplier: 2 });
    expect(result.recommendedLimit).toBe(200);
  });

  it("uses the single value for a sample of one", () => {
    const result = recommendSpendingLimit([42]);
    expect(result.percentileValue).toBe(42);
    expect(result.recommendedLimit).toBe(63);
  });

  it("does not mutate the input array", () => {
    const amounts = [30, 10, 20];
    recommendSpendingLimit(amounts);
    expect(amounts).toEqual([30, 10, 20]);
  });

  it("throws for an empty sample", () => {
    expect(() => recommendSpendingLimit([])).toThrow(/at least one historical payment/);
  });

  it("throws for a negative amount", () => {
    expect(() => recommendSpendingLimit([10, -5])).toThrow(/not a valid non-negative payment amount/);
  });

  it("throws for a non-finite amount", () => {
    expect(() => recommendSpendingLimit([10, Infinity])).toThrow(/not a valid non-negative payment amount/);
  });

  it("throws for a percentile of 0", () => {
    expect(() => recommendSpendingLimit([10], { percentile: 0 })).toThrow(/percentile must be in/);
  });

  it("throws for a percentile above 100", () => {
    expect(() => recommendSpendingLimit([10], { percentile: 101 })).toThrow(/percentile must be in/);
  });
});
