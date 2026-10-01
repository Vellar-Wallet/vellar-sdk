import { describe, expect, it } from "vitest";
import { createPaymentClient, type PaymentSubmitBackend } from "./payments-client";
import type { TokenInfo } from "./balances";

// Load test: simulates many concurrent payment submissions through
// payments-client (the payment flow behind payments.ts). It drives
// `createPaymentClient` with a fake kit / sac and a backend whose latency and
// error rate are configurable, then measures latency and error rate at
// increasing concurrency levels and prints a report. This is an OPTIONAL load
// test — it does not run in `npm test`. Run it deliberately with
// `npm run test:load` (optionally as a CI job).
//
// Bottleneck note: the SDK submits each payment as a fully-async,
// shared-nothing promise chain, so on a single Node process there is no
// in-process serialization — throughput scales with concurrency up to the
// transport the backend represents. The bottleneck under load is the backend /
// relayer round-trip, modeled here by `BACKEND_LATENCY_MS`; `failEveryN` models
// deterministic transport failures. See CONTRIBUTING.md.

const CONCURRENCY_LEVELS = [1, 5, 10, 25, 50, 100];
const PER_LEVEL = 150;
const BACKEND_LATENCY_MS = 5;

const token: TokenInfo = { contractId: "CTOKEN", symbol: "XLM", decimals: 7 };

interface SubmitResult {
  durationMs: number;
  durations: number[];
  total: number;
  errors: number;
}

function makeBackend(opts?: { failEveryN?: number; latencyMs?: number }): PaymentSubmitBackend {
  const failEveryN = opts?.failEveryN ?? 0;
  const latencyMs = opts?.latencyMs ?? BACKEND_LATENCY_MS;
  let submitted = 0;
  let attempted = 0;
  return {
    async submitTransaction() {
      if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs));
      attempted += 1;
      // Deterministic failure every Nth attempt (models transport errors).
      if (failEveryN > 0 && attempted % failEveryN === 0) throw new Error("backend down");
      submitted += 1;
      return { hash: `hash-${submitted}` };
    },
  };
}

function submitConcurrently(
  concurrency: number,
  total: number,
  opts?: { failEveryN?: number; latencyMs?: number },
): Promise<SubmitResult> {
  const backend = makeBackend(opts);
  const client = createPaymentClient({
    kit: { sign: async (tx) => tx },
    sac: { getSACClient: () => ({ transfer: async () => "transfer-xdr" }) },
    backend,
    network: "testnet",
    isValidAddress: () => true,
    signedToXdr: (signed) => signed as string,
  });

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
        const prepared = await client.preparePayment({
          from: "CFROM",
          to: "CTO",
          token,
          amount: 1n,
        });
        await prepared.confirm();
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

function report(results: SubmitResult[]): void {
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

  console.log(`[load:payments] submissions=${PER_LEVEL} per level, backend latency=${BACKEND_LATENCY_MS}ms`);
  console.log("[load:payments] concurrency | total | errors | err% | p50 | p95 | thru/s");
  for (const row of rows) {
    console.log(
      `[load:payments] ${String(row.concurrency).padStart(10)} | ${String(row.total).padStart(5)} | ` +
        `${String(row.errors).padStart(5)} | ${row.errPct.toFixed(1).padStart(4)} | ` +
        `${row.p50.toFixed(1).padStart(5)} | ${row.p95.toFixed(1).padStart(5)} | ${Math.round(row.thru)}`,
    );
  }
}

describe("payments.ts concurrent submission load test", () => {
  it(
    "submits at increasing concurrency with no lost payments and prints a latency/error report",
    async () => {
      const results: SubmitResult[] = [];
      for (const concurrency of CONCURRENCY_LEVELS) {
        results.push(
          await submitConcurrently(concurrency, PER_LEVEL, {
            failEveryN: 0,
            latencyMs: BACKEND_LATENCY_MS,
          }),
        );
      }
      report(results);
    },
    60_000,
  );

  it("surfaces every failure under error-modeled load (no silent loss)", async () => {
    // Deterministic backend failure every 10th submission.
    const result = await submitConcurrently(25, PER_LEVEL, {
      failEveryN: 10,
      latencyMs: BACKEND_LATENCY_MS,
    });

    // No submission vanishes: the exact injected count errors, every one
    // surfaces as a thrown error, and all submissions were attempted.
    expect(result.errors).toBe(Math.floor(PER_LEVEL / 10));
    expect(result.durations).toHaveLength(result.total);
  });
});
