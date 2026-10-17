import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  X402_LATENCY_AUDIT_CONSTANTS,
  computePhaseStats,
  runX402PhaseBenchmark,
  appendBenchmarkRecord,
  readBenchmarkHistory,
} from "./x402-benchmark";
import { requirements } from "./x402-test-fixtures";

describe("x402 payment flow latency benchmark suite (#685)", () => {
  it("runs quote, sign, and submit phases against the recorded facilitator fixture and computes phase stats", async () => {
    let clock = 1000;
    const deltas = [2, 5, 3]; // quote=2ms, sign=5ms, submit=3ms -> total=10ms
    let step = 0;

    const result = await runX402PhaseBenchmark({
      version: "0.6.2",
      iterations: 5,
      nowMs: () => {
        const val = clock;
        clock += deltas[step % 3]!;
        step++;
        return val;
      },
    });

    expect(result.passed).toBe(true);
    expect(result.samples).toHaveLength(5);
    expect(result.record.phases.quote.p50Ms).toBeGreaterThan(0);
    expect(result.record.phases.sign.p50Ms).toBeGreaterThan(0);
    expect(result.record.phases.submit.p50Ms).toBeGreaterThan(0);
    expect(result.record.auditComparison.v13ViableWindowMs).toBe(25_000);
    expect(result.record.auditComparison.withinV13Floor).toBe(true);
  });

  it("flags a regression when sign+submit p95 exceeds the V-13 viable expiration floor or maxTotalP95Ms", async () => {
    let clock = 0;
    // Simulate a stalled facilitator where sign+submit takes 30,000ms (> 25,000ms V-13 floor)
    const slowResult = await runX402PhaseBenchmark({
      iterations: 3,
      nowMs: () => {
        const current = clock;
        clock += 15_000;
        return current;
      },
      quotePhase: async () => requirements(),
      signPhase: async () => "signed-header",
      submitPhase: async () => {},
    });

    expect(slowResult.passed).toBe(false);
    expect(slowResult.record.auditComparison.withinV13Floor).toBe(false);
    expect(slowResult.regressionReason).toContain("V-13 viable expiration floor");

    // Budget threshold failure even when within V-13 floor
    let fastClock = 0;
    const overBudget = await runX402PhaseBenchmark({
      iterations: 3,
      maxTotalP95Ms: 10,
      nowMs: () => {
        const current = fastClock;
        fastClock += 20; // 60ms total > 10ms budget
        return current;
      },
    });
    expect(overBudget.passed).toBe(false);
    expect(overBudget.regressionReason).toContain("exceeded configured budget");
  });

  it("persists benchmark records in append-only JSONL format and validates committed history", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vellar-bench-"));
    const historyFile = path.join(tmpDir, "history.jsonl");

    try {
      const run1 = await runX402PhaseBenchmark({ version: "0.6.1", iterations: 2 });
      const run2 = await runX402PhaseBenchmark({ version: "0.6.2", iterations: 2 });

      appendBenchmarkRecord(historyFile, run1.record);
      appendBenchmarkRecord(historyFile, run2.record);

      const history = readBenchmarkHistory(historyFile);
      expect(history).toHaveLength(2);
      expect(history[0]?.version).toBe("0.6.1");
      expect(history[1]?.version).toBe("0.6.2");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    // Verify the committed benchmarks/x402-latency-history.jsonl file
    const committedHistory = readBenchmarkHistory(
      path.join(process.cwd(), "benchmarks", "x402-latency-history.jsonl")
    );
    expect(committedHistory.length).toBeGreaterThanOrEqual(3);
    for (const entry of committedHistory) {
      expect(entry.auditComparison.withinV13Floor).toBe(true);
      expect(entry.phases.quote.p95Ms).toBeGreaterThan(0);
      expect(entry.phases.sign.p95Ms).toBeGreaterThan(0);
      expect(entry.phases.submit.p95Ms).toBeGreaterThan(0);
    }

    expect(X402_LATENCY_AUDIT_CONSTANTS.MIN_VIABLE_EXPIRATION_LEDGERS).toBe(5);
    expect(X402_LATENCY_AUDIT_CONSTANTS.DEFAULT_MAX_EXPIRATION_LEDGERS).toBe(58);
    expect(() => computePhaseStats([])).toThrow(RangeError);
  });
});
