import { describe, expect, it } from "vitest";
import { dryRunPolicy, type SampleTransaction } from "./policy-dry-run-harness";
import type { PolicyDefinition } from "../../../src/types";

const basePolicy: PolicyDefinition = {
  version: "1",
  type: "spending-limit",
  owners: ["GA", "GB"],
  threshold: 2,
  spendingLimits: { dailyXlm: "500", perTxXlm: "200" },
  allowlistedContracts: ["CALLOWED"],
};

describe("dryRunPolicy", () => {
  it("passes a transaction that satisfies every check", () => {
    const [result] = dryRunPolicy(basePolicy, [
      { id: "tx-1", amountXlm: "100", signerCount: 2, contractId: "CALLOWED" },
    ]);
    expect(result).toEqual({ transactionId: "tx-1", passed: true, reasons: [] });
  });

  it("reports a per-transaction limit violation with a clear reason", () => {
    const [result] = dryRunPolicy(basePolicy, [{ id: "tx-1", amountXlm: "250", signerCount: 2 }]);
    expect(result?.passed).toBe(false);
    expect(result?.reasons).toEqual([
      "Amount 250 XLM exceeds per-transaction limit of 200 XLM",
    ]);
  });

  it("reports a signer-threshold violation", () => {
    const [result] = dryRunPolicy(basePolicy, [{ id: "tx-1", amountXlm: "50", signerCount: 1 }]);
    expect(result?.passed).toBe(false);
    expect(result?.reasons).toEqual(["Requires 2 signer(s); transaction has 1"]);
  });

  it("reports a non-allowlisted contract", () => {
    const [result] = dryRunPolicy(basePolicy, [
      { id: "tx-1", amountXlm: "50", signerCount: 2, contractId: "CNOTALLOWED" },
    ]);
    expect(result?.passed).toBe(false);
    expect(result?.reasons).toEqual(["Contract CNOTALLOWED is not in the allowlist [CALLOWED]"]);
  });

  it("accumulates a running daily total across the batch, in order", () => {
    // No per-tx limit here, isolating the daily-accumulation behavior:
    // each transaction is individually fine, but the third pushes the
    // running total over the daily limit.
    const policy: PolicyDefinition = { ...basePolicy, spendingLimits: { dailyXlm: "500" } };
    const transactions: SampleTransaction[] = [
      { id: "tx-1", amountXlm: "200", signerCount: 2 },
      { id: "tx-2", amountXlm: "200", signerCount: 2 },
      { id: "tx-3", amountXlm: "200", signerCount: 2 }, // cumulative 600 > 500 daily limit
    ];
    const results = dryRunPolicy(policy, transactions);
    expect(results[0]?.passed).toBe(true);
    expect(results[1]?.passed).toBe(true);
    expect(results[2]?.passed).toBe(false);
    expect(results[2]?.reasons).toEqual([
      "Cumulative spend 600 XLM (including this transaction) exceeds daily limit of 500 XLM",
    ]);
  });

  it("reports every failing check for a transaction, not just the first", () => {
    const policy: PolicyDefinition = {
      ...basePolicy,
      spendingLimits: { dailyXlm: "10", perTxXlm: "5" },
    };
    const [result] = dryRunPolicy(policy, [
      { id: "tx-1", amountXlm: "20", signerCount: 1, contractId: "CNOTALLOWED" },
    ]);
    expect(result?.passed).toBe(false);
    expect(result?.reasons).toHaveLength(4);
  });

  it("skips checks the policy does not define", () => {
    const permissive: PolicyDefinition = { version: "1", type: "none", owners: ["GA"] };
    const [result] = dryRunPolicy(permissive, [
      { id: "tx-1", amountXlm: "1000000", signerCount: 0, contractId: "CANYTHING" },
    ]);
    expect(result).toEqual({ transactionId: "tx-1", passed: true, reasons: [] });
  });
});
