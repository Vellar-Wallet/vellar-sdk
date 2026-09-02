import { describe, expect, it } from "vitest";
import { buildSessionBudgetDashboardSource, type MockBudgetTracker, type MockSession } from "./session-budget-dashboard-source";

describe("buildSessionBudgetDashboardSource", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");

  const session: MockSession = {
    accountId: "CACCOUNT",
    expiresAt: "2026-07-01T00:00:00.000Z", // well over 24h out
  };

  const budget: MockBudgetTracker = {
    totalBudget: 1_000_000n,
    spent: 400_000n,
    recentSpend: [{ amount: 400_000n, at: "2026-06-15T10:00:00.000Z" }],
  };

  it("combines session and budget fields into one flat object", () => {
    const result = buildSessionBudgetDashboardSource(session, budget, now);
    expect(result).toEqual({
      accountId: "CACCOUNT",
      sessionExpiresAt: "2026-07-01T00:00:00.000Z",
      sessionStatus: "active",
      totalBudget: 1_000_000n,
      remainingBudget: 600_000n,
      recentSpend: [{ amount: 400_000n, at: "2026-06-15T10:00:00.000Z" }],
    });
  });

  it("marks a session expiring within 24h as expiring_soon", () => {
    const soon: MockSession = { accountId: "CACCOUNT", expiresAt: "2026-06-15T20:00:00.000Z" };
    const result = buildSessionBudgetDashboardSource(soon, budget, now);
    expect(result.sessionStatus).toBe("expiring_soon");
  });

  it("marks a session past its expiry as expired", () => {
    const expired: MockSession = { accountId: "CACCOUNT", expiresAt: "2026-06-01T00:00:00.000Z" };
    const result = buildSessionBudgetDashboardSource(expired, budget, now);
    expect(result.sessionStatus).toBe("expired");
  });

  it("treats an expiry exactly at now as expired (inclusive boundary)", () => {
    const atNow: MockSession = { accountId: "CACCOUNT", expiresAt: now.toISOString() };
    const result = buildSessionBudgetDashboardSource(atNow, budget, now);
    expect(result.sessionStatus).toBe("expired");
  });

  it("computes remainingBudget as totalBudget minus spent", () => {
    const zeroSpent: MockBudgetTracker = { totalBudget: 500n, spent: 0n, recentSpend: [] };
    const result = buildSessionBudgetDashboardSource(session, zeroSpent, now);
    expect(result.remainingBudget).toBe(500n);
  });

  it("carries recentSpend through unchanged", () => {
    const withHistory: MockBudgetTracker = {
      totalBudget: 100n,
      spent: 30n,
      recentSpend: [
        { amount: 10n, at: "2026-06-15T08:00:00.000Z" },
        { amount: 20n, at: "2026-06-15T09:00:00.000Z" },
      ],
    };
    const result = buildSessionBudgetDashboardSource(session, withHistory, now);
    expect(result.recentSpend).toEqual(withHistory.recentSpend);
  });
});
