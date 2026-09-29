// Tests for session-budget-context.ts (#438)
import { describe, it, expect, vi } from "vitest";
import { SpendLedgerWithContext, isRecentSession } from "./session-budget-context.js";

describe("session-budget-context (#438)", () => {
  const ASSET_USDC = "CUSDC...";
  const ASSET_XLM = "CXLM...";

  function createTestLedger(walletAddress?: string) {
    const ceilings = new Map<string, bigint>([
      [ASSET_USDC, 1_000_000n],
      [ASSET_XLM, 50_000_000n],
    ]);
    return new SpendLedgerWithContext(ceilings, walletAddress);
  }

  describe("SpendLedgerWithContext", () => {
    it("initializes with zero payments recorded", () => {
      const ledger = createTestLedger();
      const context = ledger.getSessionContext();

      expect(context.paymentsRecorded).toBe(0);
      expect(context.paymentsByAsset.size).toBe(0);
      expect(context.sessionStartedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("increments payment count when recording payments", () => {
      const ledger = createTestLedger();

      ledger.record(ASSET_USDC, 100n);
      ledger.record(ASSET_USDC, 200n);
      ledger.record(ASSET_XLM, 1000n);

      const context = ledger.getSessionContext();

      expect(context.paymentsRecorded).toBe(3);
      expect(context.paymentsByAsset.get(ASSET_USDC)).toBe(2);
      expect(context.paymentsByAsset.get(ASSET_XLM)).toBe(1);
    });

    it("reports chain-enforced mode when walletAddress is provided", () => {
      const ledger = createTestLedger("CWALLET123");
      const context = ledger.getSessionContext();

      expect(context.spendMode).toBe("chain-enforced");
    });

    it("reports process-only mode when walletAddress is absent", () => {
      const ledger = createTestLedger(undefined);
      const context = ledger.getSessionContext();

      expect(context.spendMode).toBe("process-only");
    });

    it("tracks remaining budget correctly", () => {
      const ledger = createTestLedger();

      ledger.record(ASSET_USDC, 300_000n);
      expect(ledger.remainingFor(ASSET_USDC)).toBe(700_000n);

      ledger.record(ASSET_USDC, 200_000n);
      expect(ledger.remainingFor(ASSET_USDC)).toBe(500_000n);
    });

    it("formatBudgetResponse includes all required fields", () => {
      const ledger = createTestLedger("CWALLET123");

      ledger.record(ASSET_USDC, 100_000n);
      ledger.record(ASSET_XLM, 5_000_000n);
      ledger.record(ASSET_XLM, 3_000_000n);

      const response = ledger.formatBudgetResponse();

      // Top-level fields
      expect(response.sessionStartedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(response.paymentsRecorded).toBe(3);
      expect(response.spendMode).toBe("chain-enforced");
      expect(response._note).toContain("chain-enforced");

      // Per-asset budgets
      const usdcBudget = response.budgets.find((b) => b.asset === ASSET_USDC);
      expect(usdcBudget).toBeDefined();
      expect(usdcBudget!.remaining).toBe("900000");
      expect(usdcBudget!.ceiling).toBe("1000000");
      expect(usdcBudget!.paymentsThisSession).toBe(1);

      const xlmBudget = response.budgets.find((b) => b.asset === ASSET_XLM);
      expect(xlmBudget).toBeDefined();
      expect(xlmBudget!.remaining).toBe("42000000");
      expect(xlmBudget!.paymentsThisSession).toBe(2);
    });

    it("reports zero paymentsThisSession explicitly for unused assets", () => {
      const ledger = createTestLedger();

      ledger.record(ASSET_USDC, 100n);

      const response = ledger.formatBudgetResponse();
      const xlmBudget = response.budgets.find((b) => b.asset === ASSET_XLM);

      // Zero is explicit, not absent
      expect(xlmBudget!.paymentsThisSession).toBe(0);
    });

    it("includes appropriate note for process-only mode", () => {
      const ledger = createTestLedger(undefined);
      const response = ledger.formatBudgetResponse();

      expect(response.spendMode).toBe("process-only");
      expect(response._note).toContain("process-only");
      expect(response._note).toContain("in-memory ledger is the only limit");
    });
  });

  describe("isRecentSession", () => {
    it("returns true for sessions started within threshold", () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      expect(isRecentSession(fiveMinutesAgo, 10)).toBe(true);
    });

    it("returns false for sessions started before threshold", () => {
      const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      expect(isRecentSession(twentyMinutesAgo, 10)).toBe(false);
    });

    it("handles edge case at exact threshold", () => {
      const exactlyTenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      expect(isRecentSession(exactlyTenMinutesAgo, 10)).toBe(false);
    });
  });
});
