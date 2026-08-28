import { describe, expect, it } from "vitest";
import { policiesEqual } from "./compare-policies";
import type { PolicyDefinition } from "../../../src/types";

const base: PolicyDefinition = {
  version: "1",
  type: "spending-limit",
  owners: ["GALICE", "GBOB"],
  threshold: 2,
  spendingLimits: { dailyXlm: "500", perTxXlm: "200" },
  allowlistedContracts: ["CFIRST", "CSECOND"],
  timelocks: { adminActionDelaySeconds: 3600 },
};

describe("policiesEqual", () => {
  it("returns true for identical policies", () => {
    expect(policiesEqual(base, { ...base })).toBe(true);
  });

  it("ignores owners order", () => {
    const reordered = { ...base, owners: ["GBOB", "GALICE"] };
    expect(policiesEqual(base, reordered)).toBe(true);
  });

  it("ignores allowlistedContracts order", () => {
    const reordered = { ...base, allowlistedContracts: ["CSECOND", "CFIRST"] };
    expect(policiesEqual(base, reordered)).toBe(true);
  });

  it("detects a different threshold", () => {
    expect(policiesEqual(base, { ...base, threshold: 1 })).toBe(false);
  });

  it("detects a different owners set (not just reordered)", () => {
    expect(policiesEqual(base, { ...base, owners: ["GALICE", "GCAROL"] })).toBe(false);
  });

  it("detects a different owners count", () => {
    expect(policiesEqual(base, { ...base, owners: ["GALICE", "GBOB", "GCAROL"] })).toBe(false);
  });

  it("detects a different spendingLimits value", () => {
    expect(
      policiesEqual(base, { ...base, spendingLimits: { dailyXlm: "999", perTxXlm: "200" } }),
    ).toBe(false);
  });

  it("detects a different timelocks value", () => {
    expect(policiesEqual(base, { ...base, timelocks: { adminActionDelaySeconds: 60 } })).toBe(false);
  });

  it("treats missing optional fields on both sides as equal", () => {
    const minimalA: PolicyDefinition = { version: "1", type: "none", owners: ["GALICE"] };
    const minimalB: PolicyDefinition = { version: "1", type: "none", owners: ["GALICE"] };
    expect(policiesEqual(minimalA, minimalB)).toBe(true);
  });
});
