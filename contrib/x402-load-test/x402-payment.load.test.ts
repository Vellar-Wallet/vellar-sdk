// Load test for the x402 payment path (issue #443).
//
// Follows the structure and naming of src/payments.load.test.ts. The x402 path
// holds more state per call than a plain payment: a guard pass and an amount
// parse. This load test drives the pure guard layer through many sequential and
// concurrent calls, asserting deterministic decisions and no unbounded memory
// growth.
//
// Excluded from `npm test` (the pattern `*.load.test.ts` is excluded by
// vitest.config.ts). Run deliberately with: npm run test:load
//
// Integration into CI: wire this into the existing load-test job in
// .github/workflows/ci.yml alongside src/payments.load.test.ts.

import { describe, expect, it } from "vitest";
import { selectRequirements, parseAmount } from "vellar-sdk/x402-guards";
import type { PaymentRequired, PaymentRequirements } from "vellar-sdk/x402-guards";

const CONCURRENCY_LEVELS = [1, 5, 10, 25, 50, 100];
const PER_LEVEL = 200;

const C_ADDRESS = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
const TOKEN = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";
const PAYTO = "GAN5MFH3GGAWH2UTO5DDOMDRQK6E32CE2GPAMPQT6KEHEPNHVBKJEF6A";
const CAIP2_TESTNET = "stellar:testnet";

function requirements(over: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: CAIP2_TESTNET,
    asset: TOKEN,
    amount: "1000000",
    payTo: PAYTO,
    maxTimeoutSeconds: 120,
    extra: { areFeesSponsored: true },
    ...over,
  };
}

function decoded(accepts: PaymentRequirements[]): PaymentRequired {
  return { x402Version: 2, accepts };
}

interface RunResult {
  durationMs: number;
  durations: number[];
  total: number;
  errors: number;
}

function runGuardPipeline(
  concurrency: number,
  total: number,
): Promise<RunResult> {
  const opts = { maxAmount: 10_000_000n };
  const d = decoded([requirements()]);

  const durations: number[] = [];
  let errors = 0;
  let idx = 0;
  const started = performance.now();

  const worker = async () => {
    for (;;) {
      const i = idx;
      idx += 1;
      if (i >= total) break;
      const t0 = performance.now();
      try {
        // Guard pass — the pure decision layer.
        const selected = selectRequirements(d, opts, CAIP2_TESTNET);
        // Parse the selected amount (validates it as i128).
        parseAmount(selected.amount);
      } catch {
        errors += 1;
      }
      durations.push(performance.now() - t0);
    }
  };

  return Promise.all(Array.from({ length: concurrency }, worker)).then(() => ({
    durationMs: performance.now() - started,
    durations,
    total,
    errors,
  }));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx]!;
}

function report(results: RunResult[]): void {
  const rows = results.map((r, i) => {
    const sorted = [...r.durations].sort((a, b) => a - b);
    return {
      concurrency: CONCURRENCY_LEVELS[i]!,
      total: r.total,
      errors: r.errors,
      errPct: (r.errors / r.total) * 100,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      thru: (r.total / r.durationMs) * 1000,
    };
  });

  console.log(`[load:x402] iterations=${PER_LEVEL} per level`);
  console.log("[load:x402] concurrency | total | errors | err% | p50 | p95 | thru/s");
  for (const row of rows) {
    console.log(
      `[load:x402] ${String(row.concurrency).padStart(10)} | ${String(row.total).padStart(5)} | ` +
        `${String(row.errors).padStart(5)} | ${row.errPct.toFixed(1).padStart(4)} | ` +
        `${row.p50.toFixed(3).padStart(5)} | ${row.p95.toFixed(3).padStart(5)} | ${Math.round(row.thru)}`,
    );
  }
}

describe("x402 payment path load test", () => {
  it(
    "runs at increasing concurrency with identical guard decisions and prints a report",
    async () => {
      const results: RunResult[] = [];
      for (const concurrency of CONCURRENCY_LEVELS) {
        results.push(await runGuardPipeline(concurrency, PER_LEVEL));
      }
      report(results);

      // Every iteration must succeed — the guard layer is pure and deterministic.
      for (const r of results) {
        expect(r.errors).toBe(0);
      }
    },
    60_000,
  );

  it(
    "asserts identical guard decisions under concurrency (no shared mutable state)",
    async () => {
      const opts = { maxAmount: 10_000_000n };
      const d = decoded([requirements()]);
      const concurrency = 50;
      const perWorker = 100;
      let idx = 0;
      const mu: PaymentRequirements[] = [];

      const worker = async () => {
        for (;;) {
          const i = idx;
          idx += 1;
          if (i >= perWorker) break;
          mu.push(selectRequirements(d, opts, CAIP2_TESTNET));
        }
      };

      await Promise.all(Array.from({ length: concurrency }, worker));

      // Every decision must be structurally identical.
      for (const r of mu) {
        expect(r.scheme).toBe("exact");
        expect(r.network).toBe(CAIP2_TESTNET);
        expect(r.asset).toBe(TOKEN);
        expect(r.amount).toBe("1000000");
        expect(r.payTo).toBe(PAYTO);
      }
    },
    30_000,
  );

  it(
    "shows no unbounded memory growth across a long run",
    async () => {
      const iterations = 5_000;
      const opts = { maxAmount: 10_000_000n };
      const d = decoded([requirements()]);

      // Baseline.
      globalThis.gc?.();
      const before = process.memoryUsage().heapUsed;

      for (let i = 0; i < iterations; i++) {
        selectRequirements(d, opts, CAIP2_TESTNET);
        parseAmount("1000000");
      }

      globalThis.gc?.();
      const after = process.memoryUsage().heapUsed;
      const growthMb = (after - before) / (1024 * 1024);

      console.log(`[load:x402] memory: ${iterations} iterations, heap growth=${growthMb.toFixed(2)} MB`);

      // Growth must stay bounded — 10 MB for 5k iterations is generous.
      expect(growthMb).toBeLessThan(10);
    },
    30_000,
  );
});