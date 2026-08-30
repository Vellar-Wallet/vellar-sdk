// Example: a data source function that combines a mock session with a mock
// x402 budget tracker into a single object suitable for feeding a
// dashboard UI — session expiry info alongside remaining budget and recent
// spend.
//
// Run with: npx tsx session-budget-dashboard-source.ts

export type SessionExpiryStatus = "active" | "expiring_soon" | "expired";

export interface MockSession {
  accountId: string;
  expiresAt: string;
}

export interface MockSpendRecord {
  amount: bigint;
  at: string;
}

export interface MockBudgetTracker {
  totalBudget: bigint;
  spent: bigint;
  recentSpend: MockSpendRecord[];
}

export interface SessionBudgetDashboardSource {
  accountId: string;
  sessionExpiresAt: string;
  sessionStatus: SessionExpiryStatus;
  totalBudget: bigint;
  remainingBudget: bigint;
  recentSpend: MockSpendRecord[];
}

// A session within this window of expiry (but not yet expired) is
// "expiring soon" — same 24h lead time as the session-key-dashboard-source
// example, for the same reason: enough lead time for a dashboard to flag it.
const EXPIRING_SOON_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

function sessionStatusFor(expiresAt: string, now: Date): SessionExpiryStatus {
  const msUntilExpiry = new Date(expiresAt).getTime() - now.getTime();
  if (msUntilExpiry <= 0) return "expired";
  if (msUntilExpiry <= EXPIRING_SOON_WINDOW_MS) return "expiring_soon";
  return "active";
}

/**
 * Combines a mock session and a mock budget tracker into a single flat
 * object shaped for a dashboard UI: session expiry status alongside
 * remaining budget and recent spend history. Given a simulated "now"
 * (defaults to the real current time, but the demo and tests pass a fixed
 * one for reproducibility).
 */
export function buildSessionBudgetDashboardSource(
  session: MockSession,
  budget: MockBudgetTracker,
  now: Date = new Date(),
): SessionBudgetDashboardSource {
  return {
    accountId: session.accountId,
    sessionExpiresAt: session.expiresAt,
    sessionStatus: sessionStatusFor(session.expiresAt, now),
    totalBudget: budget.totalBudget,
    remainingBudget: budget.totalBudget - budget.spent,
    recentSpend: budget.recentSpend,
  };
}

function main() {
  // A fixed "now" so the example's output is reproducible.
  const now = new Date("2026-06-15T12:00:00.000Z");

  const session: MockSession = {
    accountId: "CDASHBOARDDEMOACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    expiresAt: "2026-06-15T20:00:00.000Z", // 8h out
  };

  const budget: MockBudgetTracker = {
    totalBudget: 1_000_000n,
    spent: 650_000n,
    recentSpend: [
      { amount: 300_000n, at: "2026-06-15T09:00:00.000Z" },
      { amount: 350_000n, at: "2026-06-15T11:30:00.000Z" },
    ],
  };

  const dashboardSource = buildSessionBudgetDashboardSource(session, budget, now);

  console.log(`Account: ${dashboardSource.accountId}`);
  console.log(`Session: ${dashboardSource.sessionStatus} (expires ${dashboardSource.sessionExpiresAt})`);
  console.log(`Budget: ${dashboardSource.remainingBudget} remaining of ${dashboardSource.totalBudget}`);
  console.log("Recent spend:");
  for (const record of dashboardSource.recentSpend) {
    console.log(`  ${record.amount} at ${record.at}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
