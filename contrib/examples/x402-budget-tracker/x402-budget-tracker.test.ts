import { describe, expect, it } from "vitest";
import { X402BudgetTracker } from "./x402-budget-tracker";

describe("X402BudgetTracker", () => {
  it("approves a payment within the budget and reduces the remaining allowance", () => {
    const tracker = new X402BudgetTracker(1000n);
    const decision = tracker.tryRecordPayment(300n);

    expect(decision).toEqual({ approved: true, remainingBudget: 700n });
    expect(tracker.remainingBudget).toBe(700n);
    expect(tracker.totalSpent).toBe(300n);
  });

  it("rejects a payment that would exceed the remaining budget, with a reason", () => {
    const tracker = new X402BudgetTracker(1000n);
    tracker.tryRecordPayment(700n);

    const decision = tracker.tryRecordPayment(400n);

    expect(decision.approved).toBe(false);
    expect(decision.reason).toMatch(/exceed remaining budget/);
    expect(decision.remainingBudget).toBe(300n);
  });

  it("does not record a rejected payment against spend", () => {
    const tracker = new X402BudgetTracker(1000n);
    tracker.tryRecordPayment(700n);
    tracker.tryRecordPayment(400n); // rejected

    expect(tracker.totalSpent).toBe(700n);
    expect(tracker.remainingBudget).toBe(300n);
  });

  it("approves a payment that exactly exhausts the remaining budget", () => {
    const tracker = new X402BudgetTracker(1000n);
    const decision = tracker.tryRecordPayment(1000n);
    expect(decision.approved).toBe(true);
    expect(tracker.remainingBudget).toBe(0n);
  });

  it("rejects any further payment once the budget is exhausted", () => {
    const tracker = new X402BudgetTracker(1000n);
    tracker.tryRecordPayment(1000n);
    const decision = tracker.tryRecordPayment(1n);
    expect(decision.approved).toBe(false);
  });

  it("throws for a negative total budget", () => {
    expect(() => new X402BudgetTracker(-1n)).toThrow(RangeError);
  });

  it("throws for a negative payment amount", () => {
    const tracker = new X402BudgetTracker(1000n);
    expect(() => tracker.tryRecordPayment(-1n)).toThrow(RangeError);
  });

  it("processes a mixed sequence, approving and rejecting as budget allows", () => {
    const tracker = new X402BudgetTracker(1_000_000n);
    const results = [300_000n, 400_000n, 500_000n, 200_000n].map((amount) =>
      tracker.tryRecordPayment(amount).approved,
    );
    expect(results).toEqual([true, true, false, true]);
    expect(tracker.totalSpent).toBe(900_000n);
  });
});
