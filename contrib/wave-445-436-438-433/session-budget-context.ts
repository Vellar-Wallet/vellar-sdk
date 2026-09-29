// Reference implementation for #438: Session budget with time context
// This demonstrates adding session metadata to x402_session_budget tool output.

export interface SessionContext {
  /** ISO timestamp when this ledger was created (process start) */
  sessionStartedAt: string;
  /** Total number of payments recorded across all assets */
  paymentsRecorded: number;
  /** Per-asset payment counts */
  paymentsByAsset: ReadonlyMap<string, number>;
  /**
   * Spend enforcement mode:
   * - "chain-enforced": Layer 2, on-chain policy is the real boundary
   * - "process-only": Layer 1, in-memory ledger is the only limit
   */
  spendMode: "chain-enforced" | "process-only";
}

export interface BudgetResponse {
  sessionStartedAt: string;
  paymentsRecorded: number;
  spendMode: "chain-enforced" | "process-only";
  budgets: Array<{
    asset: string;
    remaining: string;
    ceiling: string;
    paymentsThisSession: number;
  }>;
  _note: string;
}

/**
 * Enhanced spend ledger that tracks session context.
 */
export class SpendLedgerWithContext {
  private readonly spent = new Map<string, bigint>();
  private readonly paymentCounts = new Map<string, number>();
  private readonly sessionStartedAt: string;
  private readonly spendMode: "chain-enforced" | "process-only";

  constructor(
    private readonly ceilings: ReadonlyMap<string, bigint>,
    walletAddress?: string,
  ) {
    this.sessionStartedAt = new Date().toISOString();
    this.spendMode = walletAddress ? "chain-enforced" : "process-only";
  }

  /**
   * Record a payment, incrementing both spend amount and payment count.
   */
  record(asset: string, amount: bigint): void {
    const current = this.spent.get(asset) ?? 0n;
    this.spent.set(asset, current + amount);

    const count = this.paymentCounts.get(asset) ?? 0;
    this.paymentCounts.set(asset, count + 1);
  }

  /**
   * Get remaining ceiling for an asset.
   */
  remainingFor(asset: string): bigint {
    const ceiling = this.ceilings.get(asset);
    if (ceiling === undefined) {
      throw new Error(`Asset ${asset} has no configured ceiling.`);
    }
    const used = this.spent.get(asset) ?? 0n;
    return ceiling - used;
  }

  /**
   * Get session context with all metadata.
   */
  getSessionContext(): SessionContext {
    let totalPayments = 0;
    for (const count of this.paymentCounts.values()) {
      totalPayments += count;
    }

    return {
      sessionStartedAt: this.sessionStartedAt,
      paymentsRecorded: totalPayments,
      paymentsByAsset: new Map(this.paymentCounts),
      spendMode: this.spendMode,
    };
  }

  /**
   * Format session budget response for the MCP tool.
   */
  formatBudgetResponse(): BudgetResponse {
    const context = this.getSessionContext();
    const budgets: BudgetResponse["budgets"] = [];

    for (const [asset, ceiling] of this.ceilings.entries()) {
      const remaining = this.remainingFor(asset);
      const paymentsThisSession = context.paymentsByAsset.get(asset) ?? 0;

      budgets.push({
        asset,
        remaining: remaining.toString(),
        ceiling: ceiling.toString(),
        paymentsThisSession,
      });
    }

    const note =
      context.spendMode === "chain-enforced"
        ? "Spend mode is chain-enforced: the on-chain policy is the real boundary. " +
          "This ledger is process-local and resets on restart."
        : "Spend mode is process-only: this in-memory ledger is the only limit and " +
          "resets on restart. Zero paymentsRecorded after recent restart means " +
          "nothing was spent yet, not that capacity is genuinely unused.";

    return {
      sessionStartedAt: context.sessionStartedAt,
      paymentsRecorded: context.paymentsRecorded,
      spendMode: context.spendMode,
      budgets,
      _note: note,
    };
  }
}

/**
 * Helper to check if a session started recently (within last N minutes).
 */
export function isRecentSession(sessionStartedAt: string, withinMinutes: number): boolean {
  const started = new Date(sessionStartedAt).getTime();
  const now = Date.now();
  const threshold = withinMinutes * 60 * 1000;
  return now - started < threshold;
}
