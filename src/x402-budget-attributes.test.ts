// Pure-logic tests for attribute-based x402 session key budget scoping
// (#225): rule evaluation, validation, denial, time windows, and the
// in-memory tracker. Signer/client WIRING is tested in x402-client.test.ts,
// matching how x402-signer-capabilities vs x402-signer.test.ts split.

import { describe, expect, it } from "vitest";
import {
  assertBudgetAttributes,
  assertValidBudgetAttributeRules,
  BudgetAttributeDeniedError,
  createInMemoryBudgetAttributeTracker,
  evaluateBudgetAttributes,
  InvalidBudgetAttributeRuleError,
  matchingBudgetRule,
  type BudgetAttributeRequest,
  type BudgetAttributeRule,
} from "./x402-budget-attributes";

const MERCHANT_A = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";
const MERCHANT_B = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const G_MERCHANT = "GAVU25UK4ISUJIH6KWLXX6XDKKCR3GNZ27RZ5WABRSE42ZADV2LB3ZLU";

function request(overrides: Partial<BudgetAttributeRequest> = {}): BudgetAttributeRequest {
  return {
    merchant: MERCHANT_A,
    amount: 100n,
    at: new Date("2026-08-15T12:00:00.000Z"), // a Saturday, noon UTC
    ...overrides,
  };
}

describe("evaluateBudgetAttributes", () => {
  it("permits everything when no rules are configured (opt-in scoping)", () => {
    expect(evaluateBudgetAttributes([], request())).toBe(true);
  });

  it("permits a request matching merchant and within the per-payment ceiling", () => {
    const rules = [{ merchant: MERCHANT_A, maxAmount: 200n }];
    expect(evaluateBudgetAttributes(rules, request({ amount: 150n }))).toBe(true);
  });

  it("denies a different merchant", () => {
    const rules = [{ merchant: MERCHANT_A, maxAmount: 200n }];
    expect(evaluateBudgetAttributes(rules, request({ merchant: MERCHANT_B }))).toBe(false);
  });

  it("denies an amount exceeding the matching rule's ceiling", () => {
    const rules = [{ merchant: MERCHANT_A, maxAmount: 50n }];
    expect(evaluateBudgetAttributes(rules, request({ amount: 51n }))).toBe(false);
  });

  it("permits an amount exactly at the ceiling", () => {
    const rules = [{ merchant: MERCHANT_A, maxAmount: 100n }];
    expect(evaluateBudgetAttributes(rules, request({ amount: 100n }))).toBe(true);
  });

  it("a wildcard merchant permits any merchant", () => {
    const rules = [{ merchant: "*", maxAmount: 500n }];
    expect(evaluateBudgetAttributes(rules, request({ merchant: MERCHANT_B }))).toBe(true);
  });

  describe("category matching", () => {
    it("a rule with no category matches a request with no category", () => {
      const rules = [{ merchant: MERCHANT_A, maxAmount: 500n }];
      expect(evaluateBudgetAttributes(rules, request())).toBe(true);
    });

    it("a rule with a specific category does not match a request with no category", () => {
      const rules = [{ merchant: MERCHANT_A, category: "groceries", maxAmount: 500n }];
      expect(evaluateBudgetAttributes(rules, request())).toBe(false);
    });

    it("a rule with a specific category matches only that category", () => {
      const rules = [{ merchant: MERCHANT_A, category: "groceries", maxAmount: 500n }];
      expect(
        evaluateBudgetAttributes(rules, request({ category: "groceries" })),
      ).toBe(true);
      expect(
        evaluateBudgetAttributes(rules, request({ category: "electronics" })),
      ).toBe(false);
    });

    it('a "*" category matches any category, including none', () => {
      const rules = [{ merchant: MERCHANT_A, category: "*", maxAmount: 500n }];
      expect(evaluateBudgetAttributes(rules, request())).toBe(true);
      expect(evaluateBudgetAttributes(rules, request({ category: "anything" }))).toBe(true);
    });
  });

  describe("time window matching", () => {
    it("permits inside an hour range not wrapping midnight", () => {
      const rules = [
        { merchant: MERCHANT_A, maxAmount: 500n, window: { startHourUtc: 9, endHourUtc: 17 } },
      ];
      expect(
        evaluateBudgetAttributes(rules, request({ at: new Date("2026-08-15T12:00:00.000Z") })),
      ).toBe(true);
    });

    it("denies outside an hour range not wrapping midnight", () => {
      const rules = [
        { merchant: MERCHANT_A, maxAmount: 500n, window: { startHourUtc: 9, endHourUtc: 17 } },
      ];
      expect(
        evaluateBudgetAttributes(rules, request({ at: new Date("2026-08-15T20:00:00.000Z") })),
      ).toBe(false);
    });

    it("permits inside an hour range that wraps midnight", () => {
      const rules = [
        { merchant: MERCHANT_A, maxAmount: 500n, window: { startHourUtc: 22, endHourUtc: 6 } },
      ];
      expect(
        evaluateBudgetAttributes(rules, request({ at: new Date("2026-08-15T23:30:00.000Z") })),
      ).toBe(true);
      expect(
        evaluateBudgetAttributes(rules, request({ at: new Date("2026-08-16T02:00:00.000Z") })),
      ).toBe(true);
    });

    it("denies outside an hour range that wraps midnight", () => {
      const rules = [
        { merchant: MERCHANT_A, maxAmount: 500n, window: { startHourUtc: 22, endHourUtc: 6 } },
      ];
      expect(
        evaluateBudgetAttributes(rules, request({ at: new Date("2026-08-15T12:00:00.000Z") })),
      ).toBe(false);
    });

    it("restricts by day of week", () => {
      const rules = [{ merchant: MERCHANT_A, maxAmount: 500n, window: { daysUtc: [1, 2, 3, 4, 5] } }];
      // 2026-08-15 is a Saturday (day 6).
      expect(
        evaluateBudgetAttributes(rules, request({ at: new Date("2026-08-15T12:00:00.000Z") })),
      ).toBe(false);
      // 2026-08-17 is a Monday (day 1).
      expect(
        evaluateBudgetAttributes(rules, request({ at: new Date("2026-08-17T12:00:00.000Z") })),
      ).toBe(true);
    });

    it("combines day-of-week and hour range (both must match)", () => {
      const rules = [
        {
          merchant: MERCHANT_A,
          maxAmount: 500n,
          window: { daysUtc: [1, 2, 3, 4, 5], startHourUtc: 9, endHourUtc: 17 },
        },
      ];
      // Monday but outside hours.
      expect(
        evaluateBudgetAttributes(rules, request({ at: new Date("2026-08-17T20:00:00.000Z") })),
      ).toBe(false);
      // Monday and inside hours.
      expect(
        evaluateBudgetAttributes(rules, request({ at: new Date("2026-08-17T12:00:00.000Z") })),
      ).toBe(true);
    });
  });

  it("matches when ANY rule in a multi-rule set permits (OR semantics), using the FIRST match", () => {
    const rules = [
      { merchant: MERCHANT_A, maxAmount: 10n },
      { merchant: MERCHANT_A, category: "*", maxAmount: 1000n },
    ];
    // The first rule matches (no category on either side) and its lower
    // ceiling applies — first-match wins, not "most permissive rule wins".
    expect(evaluateBudgetAttributes(rules, request({ amount: 500n }))).toBe(false);
  });
});

describe("matchingBudgetRule", () => {
  it("returns the first rule that matches", () => {
    const ruleA: BudgetAttributeRule = { merchant: MERCHANT_A, maxAmount: 10n };
    const ruleB: BudgetAttributeRule = { merchant: "*", maxAmount: 1000n };
    expect(matchingBudgetRule([ruleA, ruleB], request())).toBe(ruleA);
  });

  it("returns undefined when nothing matches", () => {
    const ruleA: BudgetAttributeRule = { merchant: MERCHANT_B, maxAmount: 10n };
    expect(matchingBudgetRule([ruleA], request())).toBeUndefined();
  });
});

describe("assertBudgetAttributes", () => {
  it("does not throw when permitted and no tracker is given", async () => {
    await expect(
      assertBudgetAttributes([{ merchant: MERCHANT_A, maxAmount: 200n }], request()),
    ).resolves.toBeUndefined();
  });

  it("throws BudgetAttributeDeniedError when no rule matches", async () => {
    const rules = [{ merchant: MERCHANT_B, maxAmount: 200n }];
    await expect(assertBudgetAttributes(rules, request())).rejects.toBeInstanceOf(
      BudgetAttributeDeniedError,
    );
  });

  it("throws BudgetAttributeDeniedError when the per-payment ceiling is exceeded", async () => {
    const rules = [{ merchant: MERCHANT_A, maxAmount: 50n }];
    try {
      await assertBudgetAttributes(rules, request({ amount: 51n }));
      expect.fail("expected assertBudgetAttributes to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetAttributeDeniedError);
      const denied = err as BudgetAttributeDeniedError;
      expect(denied.request.amount).toBe(51n);
      expect(denied.rules).toBe(rules);
      expect(denied.message).toMatch(/per-payment ceiling/);
    }
  });

  it("does not throw when no tracker is supplied even if periodMaxAmount is set", async () => {
    // periodMaxAmount without a tracker means the period ceiling simply isn't
    // enforced — documented behaviour, not a silent bug.
    const rules = [{ merchant: MERCHANT_A, maxAmount: 200n, periodMaxAmount: 10n }];
    await expect(
      assertBudgetAttributes(rules, request({ amount: 150n })),
    ).resolves.toBeUndefined();
  });

  it("throws when a tracker reports the period ceiling would be exceeded", async () => {
    const rules = [{ merchant: MERCHANT_A, maxAmount: 200n, periodMaxAmount: 100n }];
    const tracker = {
      spent: async () => 60n,
      record: async () => {},
    };
    await expect(
      assertBudgetAttributes(rules, request({ amount: 50n }), tracker),
    ).rejects.toBeInstanceOf(BudgetAttributeDeniedError);
  });

  it("does not throw when a tracker reports the period ceiling is not exceeded", async () => {
    const rules = [{ merchant: MERCHANT_A, maxAmount: 200n, periodMaxAmount: 100n }];
    const tracker = {
      spent: async () => 30n,
      record: async () => {},
    };
    await expect(
      assertBudgetAttributes(rules, request({ amount: 50n }), tracker),
    ).resolves.toBeUndefined();
  });

  it("permits an amount that exactly reaches the period ceiling", async () => {
    const rules = [{ merchant: MERCHANT_A, maxAmount: 200n, periodMaxAmount: 100n }];
    const tracker = { spent: async () => 50n, record: async () => {} };
    await expect(
      assertBudgetAttributes(rules, request({ amount: 50n }), tracker),
    ).resolves.toBeUndefined();
  });
});

describe("assertValidBudgetAttributeRules", () => {
  it("accepts an empty rule set", () => {
    expect(() => assertValidBudgetAttributeRules([])).not.toThrow();
  });

  it("accepts valid merchant addresses (G and C) and wildcards", () => {
    expect(() =>
      assertValidBudgetAttributeRules([
        { merchant: MERCHANT_A, maxAmount: 1n },
        { merchant: G_MERCHANT, maxAmount: 1n },
        { merchant: "*", maxAmount: 1n },
      ]),
    ).not.toThrow();
  });

  it("rejects a merchant that is not a Stellar address or wildcard", () => {
    expect(() =>
      assertValidBudgetAttributeRules([{ merchant: "not-an-address", maxAmount: 1n }]),
    ).toThrow(InvalidBudgetAttributeRuleError);
  });

  it("rejects a zero or negative maxAmount", () => {
    expect(() => assertValidBudgetAttributeRules([{ merchant: "*", maxAmount: 0n }])).toThrow(
      InvalidBudgetAttributeRuleError,
    );
    expect(() => assertValidBudgetAttributeRules([{ merchant: "*", maxAmount: -1n }])).toThrow(
      InvalidBudgetAttributeRuleError,
    );
  });

  it("rejects a zero or negative periodMaxAmount", () => {
    expect(() =>
      assertValidBudgetAttributeRules([{ merchant: "*", maxAmount: 1n, periodMaxAmount: 0n }]),
    ).toThrow(InvalidBudgetAttributeRuleError);
  });

  it("rejects an out-of-range window hour", () => {
    expect(() =>
      assertValidBudgetAttributeRules([
        { merchant: "*", maxAmount: 1n, window: { startHourUtc: 24 } },
      ]),
    ).toThrow(InvalidBudgetAttributeRuleError);
    expect(() =>
      assertValidBudgetAttributeRules([
        { merchant: "*", maxAmount: 1n, window: { endHourUtc: -1 } },
      ]),
    ).toThrow(InvalidBudgetAttributeRuleError);
  });

  it("rejects an out-of-range day of week", () => {
    expect(() =>
      assertValidBudgetAttributeRules([
        { merchant: "*", maxAmount: 1n, window: { daysUtc: [7] } },
      ]),
    ).toThrow(InvalidBudgetAttributeRuleError);
  });

  it("accepts a fully specified valid window", () => {
    expect(() =>
      assertValidBudgetAttributeRules([
        {
          merchant: "*",
          maxAmount: 1n,
          window: { startHourUtc: 0, endHourUtc: 23, daysUtc: [0, 6] },
        },
      ]),
    ).not.toThrow();
  });
});

describe("createInMemoryBudgetAttributeTracker", () => {
  it("starts at zero spend for a rule never recorded against", async () => {
    const tracker = createInMemoryBudgetAttributeTracker();
    const rule: BudgetAttributeRule = { merchant: "*", maxAmount: 1n };
    expect(await tracker.spent(rule)).toBe(0n);
  });

  it("accumulates recorded spend for a rule", async () => {
    const tracker = createInMemoryBudgetAttributeTracker();
    const rule: BudgetAttributeRule = { merchant: "*", maxAmount: 1n };
    await tracker.record(rule, 30n);
    await tracker.record(rule, 20n);
    expect(await tracker.spent(rule)).toBe(50n);
  });

  it("tracks separate rules independently, even with identical shapes", async () => {
    const tracker = createInMemoryBudgetAttributeTracker();
    const ruleA: BudgetAttributeRule = { merchant: MERCHANT_A, maxAmount: 1n };
    const ruleB: BudgetAttributeRule = { merchant: MERCHANT_A, maxAmount: 1n };
    await tracker.record(ruleA, 30n);
    expect(await tracker.spent(ruleA)).toBe(30n);
    expect(await tracker.spent(ruleB)).toBe(0n);
  });
});
