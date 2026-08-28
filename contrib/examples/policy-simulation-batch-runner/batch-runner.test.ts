import { describe, expect, it } from "vitest";
import type { PolicyDefinition } from "../../../src/types";
import { runPolicySimulationBatch, type SampleTransaction } from "./batch-runner";

describe("runPolicySimulationBatch", () => {
  const policy: PolicyDefinition = {
    version: "1",
    type: "spending-limit",
    owners: ["GOWNER"],
    spendingLimits: { dailyXlm: "300", perTxXlm: "200" },
    allowlistedContracts: ["CALLOWED"],
  };

  it("passes transactions within both the per-tx and daily limits", () => {
    const transactions: SampleTransaction[] = [
      { id: "tx-1", amountXlm: "100" },
      { id: "tx-2", amountXlm: "150" },
    ];
    const result = runPolicySimulationBatch(policy, transactions);
    expect(result).toEqual({ total: 2, passed: 2, failed: 0, failures: [] });
  });

  it("fails a transaction over the per-tx limit", () => {
    const result = runPolicySimulationBatch(policy, [{ id: "tx-1", amountXlm: "250" }]);
    expect(result.passed).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.failures[0]).toEqual({
      id: "tx-1",
      reason: "amount 250 XLM exceeds per-transaction limit 200 XLM",
    });
  });

  it("fails a transaction to a non-allowlisted contract", () => {
    const result = runPolicySimulationBatch(policy, [
      { id: "tx-1", amountXlm: "10", contractId: "CBADCONTRACT" },
    ]);
    expect(result.failures[0]).toEqual({
      id: "tx-1",
      reason: "contract CBADCONTRACT is not in the allowlisted contracts",
    });
  });

  it("passes a transaction to an allowlisted contract", () => {
    const result = runPolicySimulationBatch(policy, [
      { id: "tx-1", amountXlm: "10", contractId: "CALLOWED" },
    ]);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("fails once the cumulative daily total would be exceeded, without double counting the failed amount", () => {
    const transactions: SampleTransaction[] = [
      { id: "tx-1", amountXlm: "200" },
      { id: "tx-2", amountXlm: "150" }, // 200 + 150 = 350 > 300 daily limit
      { id: "tx-3", amountXlm: "50" }, // 200 + 50 = 250 <= 300: passes, since tx-2's amount was never added
    ];
    const result = runPolicySimulationBatch(policy, transactions);
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.failures[0]?.id).toBe("tx-2");
    expect(result.failures[0]?.reason).toContain("exceed daily limit");
  });

  it("returns an empty summary for an empty batch", () => {
    expect(runPolicySimulationBatch(policy, [])).toEqual({
      total: 0,
      passed: 0,
      failed: 0,
      failures: [],
    });
  });
});
