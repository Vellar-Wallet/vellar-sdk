// Example: track an agent's x402 spend over time against a configured
// budget, reporting a clear rejection reason when a proposed payment would
// exceed the remaining allowance. A client-side companion to the on-chain
// spending-limit policy — see src/x402-types.ts's X402PayOptions.maxAmount
// doc comment, which makes the same "client-side guard, not the durable
// budget" distinction.
//
// Run with: npx tsx x402-budget-tracker.ts

export interface BudgetDecision {
  approved: boolean;
  /** Present only when approved is false. */
  reason?: string;
  /** Remaining allowance after this decision (unchanged if rejected). */
  remainingBudget: bigint;
}

/**
 * Tracks spend against a fixed total budget (in the asset's base units).
 * Each call to `tryRecordPayment` either records the amount (if it fits in
 * the remaining allowance) or rejects it with a reason, leaving the
 * tracked spend unchanged — a rejected payment is never partially recorded.
 */
export class X402BudgetTracker {
  private spent = 0n;

  constructor(private readonly totalBudget: bigint) {
    if (totalBudget < 0n) {
      throw new RangeError("totalBudget must not be negative");
    }
  }

  /** Remaining allowance: totalBudget - spent so far. */
  get remainingBudget(): bigint {
    return this.totalBudget - this.spent;
  }

  /** Total spent so far (only successfully recorded payments count). */
  get totalSpent(): bigint {
    return this.spent;
  }

  tryRecordPayment(amount: bigint): BudgetDecision {
    if (amount < 0n) {
      throw new RangeError("amount must not be negative");
    }
    if (amount > this.remainingBudget) {
      return {
        approved: false,
        reason: `Payment of ${amount} would exceed remaining budget of ${this.remainingBudget} (total ${this.totalBudget}, already spent ${this.spent})`,
        remainingBudget: this.remainingBudget,
      };
    }
    this.spent += amount;
    return { approved: true, remainingBudget: this.remainingBudget };
  }
}

function main() {
  const tracker = new X402BudgetTracker(1_000_000n); // 1,000,000 base units
  const plannedPayments = [300_000n, 400_000n, 500_000n, 200_000n];

  for (const amount of plannedPayments) {
    const decision = tracker.tryRecordPayment(amount);
    if (decision.approved) {
      console.log(`Payment of ${amount}: APPROVED (remaining: ${decision.remainingBudget})`);
    } else {
      console.log(`Payment of ${amount}: REJECTED — ${decision.reason}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
