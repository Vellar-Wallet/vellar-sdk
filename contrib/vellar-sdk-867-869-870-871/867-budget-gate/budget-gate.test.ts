import { describe, expect, it } from "vitest";
import { MEASURED_MAX_TX_FEE_STROOPS } from "../../../src/x402-budget-attributes.js";
import {
  checkBudgetAgainstQuote,
  estimatedFeeStroops,
  type BudgetPaymentType,
} from "./budget-gate.js";

describe("checkBudgetAgainstQuote (#867)", () => {
  it("reads its fee estimates from the real measured constants", () => {
    for (const type of Object.keys(MEASURED_MAX_TX_FEE_STROOPS) as BudgetPaymentType[]) {
      expect(estimatedFeeStroops(type)).toBe(MEASURED_MAX_TX_FEE_STROOPS[type].high);
    }
  });

  it("flags a quote that passes before fees but exceeds the budget after them", () => {
    const budget = 200n;
    const price = 100n; // within budget on its own, before the fee is added
    const result = checkBudgetAgainstQuote(price, "exact-classic", budget);

    expect(price <= budget).toBe(true);
    expect(result.withinBudget).toBe(false);
    expect(result.estimatedFeeStroops).toBe(28_711n);
    expect(result.totalStroops).toBe(28_811n);
    expect(result.shortfallStroops).toBe(28_611n);
    expect(result.reason).toContain("Do not sign");
  });

  it("treats a total exactly equal to the budget as within budget", () => {
    const fee = estimatedFeeStroops("exact-policy-governed"); // 85_999n
    const result = checkBudgetAgainstQuote(1n, "exact-policy-governed", fee + 1n);

    expect(result.withinBudget).toBe(true);
    expect(result.shortfallStroops).toBe(0n);
    expect(result.totalStroops).toBe(fee + 1n);
  });

  it("accepts a zero quote when the budget covers the fee", () => {
    const result = checkBudgetAgainstQuote(0n, "upto-smart-account", 39_949n);

    expect(result.withinBudget).toBe(true);
    expect(result.totalStroops).toBe(39_949n);
  });

  it("rejects negative prices and budgets", () => {
    expect(() => checkBudgetAgainstQuote(-1n, "exact-classic", 1_000n)).toThrow(
      /quoted price must be non-negative/,
    );
    expect(() => checkBudgetAgainstQuote(1n, "exact-classic", -1n)).toThrow(
      /max budget must be non-negative/,
    );
  });

  it("rejects an unknown payment type instead of assuming a zero fee", () => {
    expect(() =>
      checkBudgetAgainstQuote(1n, "mystery-shape" as BudgetPaymentType, 1_000n),
    ).toThrow(/unknown payment type/);
  });
});
