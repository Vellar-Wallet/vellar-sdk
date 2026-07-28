// Example: a dry-run harness that evaluates a candidate PolicyDefinition
// against a list of sample transactions and reports pass/fail with a reason
// per failing check — useful for testing a policy body before deploying it.
//
// Run with: npx tsx policy-dry-run-harness.ts

import type { PolicyDefinition } from "../../../src/types";

/** A simplified transaction shape sufficient to evaluate the policy checks
 * this harness understands (signer threshold, per-tx and daily spending
 * limits, contract allowlist). Not a real Stellar transaction. */
export interface SampleTransaction {
  id: string;
  amountXlm: string;
  contractId?: string;
  signerCount: number;
}

export interface DryRunResult {
  transactionId: string;
  passed: boolean;
  /** Empty when passed. One entry per failing check, human-readable. */
  reasons: string[];
}

// XLM has 7 decimal places (stroops); comparisons/sums are done as bigint
// stroops so this never suffers float rounding on amount comparisons.
const XLM_SCALE = 7;

function toStroops(decimal: string): bigint {
  const trimmed = decimal.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`"${decimal}" is not a valid decimal XLM amount`);
  }
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > XLM_SCALE) {
    throw new Error(`"${decimal}" has more than ${XLM_SCALE} decimal places`);
  }
  return BigInt(whole) * 10n ** BigInt(XLM_SCALE) + BigInt(fraction.padEnd(XLM_SCALE, "0") || "0");
}

function fromStroops(stroops: bigint): string {
  const scale = 10n ** BigInt(XLM_SCALE);
  const whole = stroops / scale;
  const frac = (stroops % scale).toString().padStart(XLM_SCALE, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/**
 * Evaluates `transactions` in order against `policy`. Checks applied per
 * transaction:
 *   - signer threshold (policy.threshold vs. tx.signerCount)
 *   - per-transaction spending limit (policy.spendingLimits.perTxXlm)
 *   - cumulative daily spending limit (policy.spendingLimits.dailyXlm) —
 *     tracked as a running total across the array, in the given order, so
 *     an individually-fine transaction can still fail once earlier ones in
 *     the batch have used up the daily allowance
 *   - contract allowlist (policy.allowlistedContracts), when the tx has a
 *     contractId and the policy defines a non-empty allowlist
 *
 * A transaction can fail more than one check; every failing reason is
 * reported, not just the first.
 */
export function dryRunPolicy(policy: PolicyDefinition, transactions: SampleTransaction[]): DryRunResult[] {
  const dailyLimit = policy.spendingLimits?.dailyXlm;
  let cumulative = 0n;

  return transactions.map((tx) => {
    const reasons: string[] = [];

    if (policy.threshold !== undefined && tx.signerCount < policy.threshold) {
      reasons.push(`Requires ${policy.threshold} signer(s); transaction has ${tx.signerCount}`);
    }

    const perTxLimit = policy.spendingLimits?.perTxXlm;
    if (perTxLimit !== undefined && toStroops(tx.amountXlm) > toStroops(perTxLimit)) {
      reasons.push(`Amount ${tx.amountXlm} XLM exceeds per-transaction limit of ${perTxLimit} XLM`);
    }

    cumulative += toStroops(tx.amountXlm);
    if (dailyLimit !== undefined && cumulative > toStroops(dailyLimit)) {
      reasons.push(
        `Cumulative spend ${fromStroops(cumulative)} XLM (including this transaction) exceeds daily limit of ${dailyLimit} XLM`,
      );
    }

    if (
      tx.contractId &&
      policy.allowlistedContracts &&
      policy.allowlistedContracts.length > 0 &&
      !policy.allowlistedContracts.includes(tx.contractId)
    ) {
      reasons.push(
        `Contract ${tx.contractId} is not in the allowlist [${policy.allowlistedContracts.join(", ")}]`,
      );
    }

    return { transactionId: tx.id, passed: reasons.length === 0, reasons };
  });
}

function samplePolicy(): PolicyDefinition {
  return {
    version: "1",
    type: "spending-limit",
    owners: ["GOWNER1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", "GOWNER2XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"],
    threshold: 2,
    spendingLimits: { dailyXlm: "500", perTxXlm: "200" },
    allowlistedContracts: ["CALLOWEDCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"],
  };
}

function sampleTransactions(): SampleTransaction[] {
  return [
    { id: "tx-1", amountXlm: "100", signerCount: 2, contractId: "CALLOWEDCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" },
    { id: "tx-2", amountXlm: "250", signerCount: 2 }, // exceeds per-tx limit
    { id: "tx-3", amountXlm: "150", signerCount: 1 }, // under threshold
    { id: "tx-4", amountXlm: "180", signerCount: 2, contractId: "CUNKNOWNCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" }, // not allowlisted, and pushes daily total over 500
  ];
}

function main() {
  const results = dryRunPolicy(samplePolicy(), sampleTransactions());
  for (const result of results) {
    if (result.passed) {
      console.log(`${result.transactionId}: PASS`);
    } else {
      console.log(`${result.transactionId}: FAIL`);
      for (const reason of result.reasons) {
        console.log(`  - ${reason}`);
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
