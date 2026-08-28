// Example: simulate a candidate spending-limit policy against a batch of
// sample transactions all at once (no network call — a local evaluation
// against the policy's spendingLimits/allowlistedContracts), and summarize
// pass/fail counts with a reason for each failure.
//
// Run with: npx tsx batch-runner.ts

import type { PolicyDefinition } from "../../../src/types";

export interface SampleTransaction {
  id: string;
  /** Payment amount in whole XLM, as a decimal string. */
  amountXlm: string;
  /** Destination contract, when the transaction is a contract invocation. */
  contractId?: string;
}

export interface BatchResult {
  total: number;
  passed: number;
  failed: number;
  failures: Array<{ id: string; reason: string }>;
}

/**
 * Evaluates each transaction against the policy's per-tx limit, allowlist,
 * and cumulative daily limit (in that order — the first violated rule is the
 * reported reason). Transactions are evaluated in array order, and the daily
 * total accumulates only over transactions that pass the earlier checks.
 */
export function runPolicySimulationBatch(
  policy: PolicyDefinition,
  transactions: SampleTransaction[],
): BatchResult {
  const perTxLimit = policy.spendingLimits?.perTxXlm
    ? Number(policy.spendingLimits.perTxXlm)
    : undefined;
  const dailyLimit = policy.spendingLimits?.dailyXlm
    ? Number(policy.spendingLimits.dailyXlm)
    : undefined;
  const allowlist = policy.allowlistedContracts;

  const failures: BatchResult["failures"] = [];
  let passed = 0;
  let dailyTotal = 0;

  for (const tx of transactions) {
    const amount = Number(tx.amountXlm);
    let reason: string | undefined;

    if (perTxLimit !== undefined && amount > perTxLimit) {
      reason = `amount ${tx.amountXlm} XLM exceeds per-transaction limit ${policy.spendingLimits!.perTxXlm} XLM`;
    } else if (allowlist && allowlist.length > 0 && tx.contractId && !allowlist.includes(tx.contractId)) {
      reason = `contract ${tx.contractId} is not in the allowlisted contracts`;
    } else if (dailyLimit !== undefined && dailyTotal + amount > dailyLimit) {
      reason = `cumulative daily total ${(dailyTotal + amount).toFixed(2)} XLM would exceed daily limit ${policy.spendingLimits!.dailyXlm} XLM`;
    }

    if (reason) {
      failures.push({ id: tx.id, reason });
    } else {
      passed++;
      dailyTotal += amount;
    }
  }

  return { total: transactions.length, passed, failed: failures.length, failures };
}

function main() {
  const samplePolicy: PolicyDefinition = {
    version: "1",
    type: "spending-limit",
    owners: ["GOWNERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"],
    spendingLimits: { dailyXlm: "300", perTxXlm: "200" },
    allowlistedContracts: ["CUSDCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
  };

  const sampleTransactions: SampleTransaction[] = [
    { id: "tx-1", amountXlm: "100" }, // passes; daily total now 100
    { id: "tx-2", amountXlm: "250" }, // fails: exceeds the 200 XLM per-tx limit
    { id: "tx-3", amountXlm: "50", contractId: "CNOTALLOWLISTEDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" }, // fails: contract not allowlisted
    { id: "tx-4", amountXlm: "150", contractId: "CUSDCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }, // passes; daily total now 250
    { id: "tx-5", amountXlm: "100" }, // fails: 250 + 100 = 350 exceeds the 300 XLM daily limit
  ];

  const result = runPolicySimulationBatch(samplePolicy, sampleTransactions);

  console.log(`Batch summary: ${result.passed}/${result.total} passed, ${result.failed}/${result.total} failed`);
  for (const failure of result.failures) {
    console.log(`  FAIL ${failure.id}: ${failure.reason}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
