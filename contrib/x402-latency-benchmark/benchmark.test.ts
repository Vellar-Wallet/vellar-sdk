/**
 * REFERENCE TEST IMPLEMENTATION for issue #685.
 * Copy/adapt into scripts/benchmark-x402-latency.test.ts.
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createLocalFixture,
  recordBenchmarkResult,
  runBenchmark,
  runOneBenchmarkCycle,
} from "./benchmark";

describe("x402 latency benchmark (#685)", () => {
  it("measures a non-zero, roughly-matching latency for each phase against the fixture's configured delays", async () => {
    const fixture = createLocalFixture({ quoteMs: 20, signMs: 30, submitMs: 10 });
    const result = await runOneBenchmarkCycle(fixture);

    expect(result.quoteMs).toBeGreaterThanOrEqual(15);
    expect(result.signMs).toBeGreaterThanOrEqual(25);
    expect(result.submitMs).toBeGreaterThanOrEqual(5);
    expect(result.totalMs).toBeGreaterThanOrEqual(
      result.quoteMs + result.signMs + result.submitMs - 5,
    );
  });

  it("runs multiple iterations and returns a stable median per phase", async () => {
    const fixture = createLocalFixture({ quoteMs: 5, signMs: 5, submitMs: 5 });
    const result = await runBenchmark(fixture, 5);

    expect(result.iterations).toBe(5);
    expect(result.quoteMs).toBeGreaterThan(0);
    expect(result.signMs).toBeGreaterThan(0);
    expect(result.submitMs).toBeGreaterThan(0);
    expect(typeof result.timestamp).toBe("string");
  });

  it("appends benchmark results to a committed NDJSON file, one JSON object per line, without overwriting prior runs", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "x402-bench-"));
    const resultsFile = path.join(dir, "nested", "results.ndjson");

    const fixture = createLocalFixture({ quoteMs: 1, signMs: 1, submitMs: 1 });
    const first = await runBenchmark(fixture, 2);
    recordBenchmarkResult(first, resultsFile);

    const second = await runBenchmark(fixture, 2);
    recordBenchmarkResult(second, resultsFile);

    const lines = readFileSync(resultsFile, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).iterations).toBe(2);
    expect(JSON.parse(lines[1]!).iterations).toBe(2);
  });

  it("the fixture simulates a real 402 challenge followed by a 200 on the paid retry", async () => {
    const fixture = createLocalFixture();
    const challengeResponse = await fixture.onQuoteRequest("https://fixture.example/resource");
    expect(challengeResponse.status).toBe(402);

    const headers = await fixture.signPayment(await challengeResponse.json());
    expect(headers).toHaveProperty("X-PAYMENT");

    const paidResponse = await fixture.onPaidRequest("https://fixture.example/resource", headers);
    expect(paidResponse.status).toBe(200);
  });
});
