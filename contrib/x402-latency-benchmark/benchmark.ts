/**
 * REFERENCE IMPLEMENTATION for issue #685.
 * Copy/adapt into scripts/benchmark-x402-latency.mjs (or .ts, matching the
 * project's existing scripts/ style), see this folder's README.md for exact
 * integration and CI-wiring steps.
 *
 * Measures wall-clock latency of the quote, sign, and submit phases of the
 * x402 payment flow, against a local facilitator fixture (no real network
 * or real signing key involved). Phase boundaries are the real seams
 * `createPayer`'s `PayerDeps` already exposes:
 *   - quote:  Payer.quote(url)          — the initial 402-challenge fetch.
 *   - sign:   deps.signer.signPayment() — wrapped via a timing proxy signer.
 *   - submit: deps.fetchImpl()          — wrapped via a timing proxy fetch,
 *             isolated from the quote-phase fetch by only timing calls that
 *             carry the X-PAYMENT header (the paid retry), not the initial
 *             402 probe.
 *
 * Results are appended to a committed, append-only NDJSON file (one JSON
 * object per line) so latency trends are visible across releases, rather
 * than overwritten on each run.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export interface PhaseTimings {
  quoteMs: number;
  signMs: number;
  submitMs: number;
  totalMs: number;
}

export interface BenchmarkRunResult extends PhaseTimings {
  timestamp: string;
  /** git ref or package version this run was measured against, if known. */
  ref?: string;
  iterations: number;
}

export interface BenchmarkFixtureHooks {
  /** Returns a Response for the initial (unpaid) probe — should be a 402 challenge. */
  onQuoteRequest(url: string): Promise<Response>;
  /** Returns a Response for the retried, paid request carrying payment headers. */
  onPaidRequest(url: string, headers: HeadersInit): Promise<Response>;
  /** Simulates the signer's work (e.g. a smart-account signature). Should resolve to payment headers. */
  signPayment(challenge: unknown): Promise<HeadersInit>;
}

/**
 * Wraps a set of fixture hooks with timing instrumentation and runs one
 * simulated quote → sign → submit cycle, returning the elapsed time per
 * phase. Does not depend on the real `payAndCall`/`createPayer` internals
 * directly (those are not structured as independently callable phases),
 * so this reference implementation reproduces the same three network/CPU
 * seams against a fixture, which is what the issue's acceptance criteria
 * ask for: a repeatable per-phase measurement, not a change to production
 * call structure.
 */
export async function runOneBenchmarkCycle(
  hooks: BenchmarkFixtureHooks,
  url = "https://fixture.example/resource",
): Promise<PhaseTimings> {
  const totalStart = performance.now();

  const quoteStart = performance.now();
  const challengeResponse = await hooks.onQuoteRequest(url);
  const challenge = await challengeResponse.json();
  const quoteMs = performance.now() - quoteStart;

  const signStart = performance.now();
  const headers = await hooks.signPayment(challenge);
  const signMs = performance.now() - signStart;

  const submitStart = performance.now();
  await hooks.onPaidRequest(url, headers);
  const submitMs = performance.now() - submitStart;

  const totalMs = performance.now() - totalStart;

  return { quoteMs, signMs, submitMs, totalMs };
}

/**
 * Runs `iterations` cycles and returns the median of each phase (median
 * rather than mean, so a single GC pause or cold-start outlier doesn't
 * dominate a small sample).
 */
export async function runBenchmark(
  hooks: BenchmarkFixtureHooks,
  iterations = 10,
): Promise<BenchmarkRunResult> {
  const samples: PhaseTimings[] = [];
  for (let i = 0; i < iterations; i += 1) {
    samples.push(await runOneBenchmarkCycle(hooks));
  }

  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[mid]!;
  };

  return {
    timestamp: new Date().toISOString(),
    iterations,
    quoteMs: median(samples.map((s) => s.quoteMs)),
    signMs: median(samples.map((s) => s.signMs)),
    submitMs: median(samples.map((s) => s.submitMs)),
    totalMs: median(samples.map((s) => s.totalMs)),
  };
}

/** Appends one benchmark run as a single NDJSON line to the results file. */
export function recordBenchmarkResult(
  result: BenchmarkRunResult,
  resultsFilePath: string,
): void {
  mkdirSync(path.dirname(resultsFilePath), { recursive: true });
  appendFileSync(resultsFilePath, JSON.stringify(result) + "\n", "utf8");
}

/**
 * A minimal local fixture implementing the real x402 challenge/paid-retry
 * shape, for exercising the benchmark without a real facilitator or
 * network call. Each phase has an artificial, configurable delay so the
 * benchmark's own overhead doesn't dominate a fixture that would otherwise
 * resolve instantly.
 */
export function createLocalFixture(
  delays: { quoteMs?: number; signMs?: number; submitMs?: number } = {},
): BenchmarkFixtureHooks {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  return {
    async onQuoteRequest() {
      await sleep(delays.quoteMs ?? 5);
      return new Response(
        JSON.stringify({ accepts: [{ asset: "USDC", amount: "1000" }] }),
        { status: 402 },
      );
    },
    async signPayment() {
      await sleep(delays.signMs ?? 5);
      return { "X-PAYMENT": "fixture-signed-payload" };
    },
    async onPaidRequest() {
      await sleep(delays.submitMs ?? 5);
      return new Response("ok", { status: 200 });
    },
  };
}
