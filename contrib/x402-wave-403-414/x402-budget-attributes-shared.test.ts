import { describe, expect, it } from "vitest";
import {
  assertBudgetAttributes,
  BudgetAttributeDeniedError,
  type BudgetAttributeRequest,
  type BudgetAttributeRule,
} from "../../src/x402-budget-attributes";
import {
  BudgetAttributeStoreUnavailableError,
  createSharedStateBudgetAttributeTracker,
  type BudgetAttributeStore,
} from "./x402-budget-attributes-shared";

const MERCHANT_A = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";

function request(overrides: Partial<BudgetAttributeRequest> = {}): BudgetAttributeRequest {
  return {
    merchant: MERCHANT_A,
    amount: 100n,
    at: new Date("2026-08-15T12:00:00.000Z"),
    ...overrides,
  };
}

describe("createSharedStateBudgetAttributeTracker (#403)", () => {
  it("persists spend to the underlying store and reads it back", async () => {
    const memoryStore = new Map<string, string>();
    const store: BudgetAttributeStore = {
      getItem: (k) => memoryStore.get(k) ?? null,
      setItem: (k, v) => {
        memoryStore.set(k, v);
      },
    };

    const tracker = createSharedStateBudgetAttributeTracker(store, { keyPrefix: "test_pref" });
    const rule: BudgetAttributeRule = { merchant: MERCHANT_A, maxAmount: 500n };

    expect(await tracker.spent(rule)).toBe(0n);
    await tracker.record(rule, 100n);
    expect(await tracker.spent(rule)).toBe(100n);
    await tracker.record(rule, 150n);
    expect(await tracker.spent(rule)).toBe(250n);
  });

  it("handles concurrent parallel check-then-record executions atomically", async () => {
    const memoryStore = new Map<string, string>();
    const store: BudgetAttributeStore = {
      getItem: async (k) => {
        await new Promise((r) => setTimeout(r, 5));
        return memoryStore.get(k) ?? null;
      },
      setItem: async (k, v) => {
        await new Promise((r) => setTimeout(r, 5));
        memoryStore.set(k, v);
      },
    };

    const tracker = createSharedStateBudgetAttributeTracker(store);
    const rule: BudgetAttributeRule = { merchant: MERCHANT_A, maxAmount: 1000n, periodMaxAmount: 150n };
    const rules = [rule];

    // Driven in parallel: 3 payments of 60n against period limit of 150n.
    // Room for 2 payments (120n <= 150n), 3rd payment must be denied.
    const attempts = Array.from({ length: 3 }, () =>
      tracker.runExclusively(async () => {
        const req = request({ amount: 60n });
        await assertBudgetAttributes(rules, req, tracker);
        await tracker.record(rule, 60n);
        return "success";
      }),
    );

    const results = await Promise.allSettled(attempts);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(2);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BudgetAttributeDeniedError);
    expect(await tracker.spent(rule)).toBe(120n);
  });

  it("fails CLOSED when the underlying store is unavailable or throws", async () => {
    const failingStore: BudgetAttributeStore = {
      getItem: () => {
        throw new Error("Disk / network error");
      },
      setItem: () => {
        throw new Error("Disk write error");
      },
    };

    const tracker = createSharedStateBudgetAttributeTracker(failingStore);
    const rule: BudgetAttributeRule = { merchant: MERCHANT_A, maxAmount: 500n };

    await expect(tracker.spent(rule)).rejects.toBeInstanceOf(BudgetAttributeStoreUnavailableError);
    await expect(tracker.record(rule, 50n)).rejects.toBeInstanceOf(BudgetAttributeStoreUnavailableError);
  });
});
