import { describe, expect, it } from "vitest";
import { estimateFee, UnknownFeePriorityError, type FeePriority } from "./mock-fee-service";

describe("estimateFee", () => {
  it.each([
    ["low", 100n],
    ["medium", 10_000n],
    ["high", 1_000_000n],
  ] as const)("returns a fixed fee for %s priority", (priority, expected) => {
    expect(estimateFee(priority)).toBe(expected);
  });

  it("throws UnknownFeePriorityError for an unrecognized priority", () => {
    expect(() => estimateFee("urgent" as FeePriority)).toThrow(UnknownFeePriorityError);
    expect(() => estimateFee("urgent" as FeePriority)).toThrow(/Unknown fee priority "urgent"/);
  });
});
