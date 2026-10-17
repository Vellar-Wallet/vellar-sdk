import fs from "node:fs";
import path from "node:path";
import {
  CAIP2_BY_NETWORK,
  decodePaymentRequired,
  decodeSettlementHeader,
  parseAmount,
  selectRequirements,
  utf8ToBase64,
} from "./x402-guards";
import { expirationOffsetFor } from "./x402-client";
import type { PaymentRequirements } from "./x402-types";
import { C_ADDRESS, PAYTO, TOKEN, b64, requirements } from "./x402-test-fixtures";

/**
 * Latency-sensitive constants from `src/x402-client.ts`,
 * `packages/mcp-x402-payer/src/smart-account-scheme.ts`, and
 * `docs/security-audit.md` (findings V-7 and V-13).
 */
export const X402_LATENCY_AUDIT_CONSTANTS = {
  /** Estimated Stellar ledger close time in seconds. */
  ESTIMATED_LEDGER_SECONDS: 5,
  /** Safety margin subtracted from seller window to avoid `expiration_too_far`. */
  EXPIRATION_SAFETY_MARGIN: 2,
  /** Hard protocol floor in `x402-client.ts` (3 ledgers ≈ 15s). */
  MIN_EXPIRATION_LEDGERS: 3,
  /** Viable expiration floor in `smart-account-scheme.ts` (5 ledgers ≈ 25s, V-13). */
  MIN_VIABLE_EXPIRATION_LEDGERS: 5,
  /** Default seller-requested signature lifetime ceiling (58 ledgers ≈ 290s/300s, V-7). */
  DEFAULT_MAX_EXPIRATION_LEDGERS: 58,
  /** Typical sign-to-settled latency measured during security audit V-7/V-13 (8.0s). */
  AUDIT_MEASURED_TYPICAL_SETTLEMENT_MS: 8_000,
  /** Worst-case sign-to-settled latency measured during security audit V-7/V-13 (12.0s). */
  AUDIT_MEASURED_WORST_SETTLEMENT_MS: 12_000,
} as const;

export interface PhaseStats {
  minMs: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface X402PhaseSample {
  iteration: number;
  quoteMs: number;
  signMs: number;
  submitMs: number;
  totalMs: number;
}

export interface X402BenchmarkRecord {
  version: string;
  timestamp: string;
  commit?: string;
  iterations: number;
  environment: string;
  phases: {
    quote: PhaseStats;
    sign: PhaseStats;
    submit: PhaseStats;
    total: PhaseStats;
  };
  auditComparison: {
    signToSubmitP95Ms: number;
    v13ViableWindowMs: number;
    v13HeadroomRatio: number;
    withinV13Floor: boolean;
  };
}

export interface X402BenchmarkOptions {
  version?: string;
  commit?: string;
  iterations?: number;
  /** Optional custom clock returning milliseconds (defaults to `performance.now()`). */
  nowMs?: () => number;
  /** Optional custom quote phase override for testing or custom fixtures. */
  quotePhase?: (iteration: number) => Promise<PaymentRequirements>;
  /** Optional custom sign phase override for testing or custom fixtures. */
  signPhase?: (req: PaymentRequirements, iteration: number) => Promise<string>;
  /** Optional custom submit phase override for testing or custom fixtures. */
  submitPhase?: (signedHeader: string, req: PaymentRequirements, iteration: number) => Promise<void>;
  /** Optional maximum allowed p95 total latency in ms before reporting a regression. */
  maxTotalP95Ms?: number;
}

export interface X402BenchmarkRunResult {
  record: X402BenchmarkRecord;
  samples: X402PhaseSample[];
  passed: boolean;
  regressionReason?: string;
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function computePhaseStats(values: readonly number[]): PhaseStats {
  if (values.length === 0) {
    throw new RangeError("computePhaseStats requires at least 1 sample");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const p50Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.5));
  const p95Idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);

  return {
    minMs: roundMetric(sorted[0]!),
    meanMs: roundMetric(sum / sorted.length),
    p50Ms: roundMetric(sorted[p50Idx]!),
    p95Ms: roundMetric(sorted[Math.max(0, p95Idx)]!),
    maxMs: roundMetric(sorted[sorted.length - 1]!),
  };
}

/**
 * Default recorded facilitator fixture executing the real SDK x402 guards,
 * requirement selection, expiration derivation, auth-entry payload encoding,
 * and settlement response decoding.
 */
async function defaultQuotePhase(): Promise<PaymentRequirements> {
  const challengeResponse = new Response("{}", {
    status: 402,
    headers: {
      "PAYMENT-REQUIRED": b64({
        x402Version: 2,
        error: "Payment required",
        accepts: [
          requirements({
            amount: "2500000",
            maxTimeoutSeconds: 120,
          }),
        ],
      }),
    },
  });
  const decoded = decodePaymentRequired(challengeResponse);
  return selectRequirements(
    decoded,
    { maxAmount: 10_000_000n, allowedAssets: [TOKEN] },
    CAIP2_BY_NETWORK.testnet
  );
}

async function defaultSignPhase(req: PaymentRequirements): Promise<string> {
  const amount = parseAmount(req.amount);
  const expirationOffset = expirationOffsetFor(req.maxTimeoutSeconds);
  const envelopePayload = {
    x402Version: 2,
    accepted: req,
    payload: {
      from: C_ADDRESS,
      to: req.payTo,
      amount: amount.toString(),
      expirationLedgerOffset: expirationOffset,
      transaction: `AAAAAgAAAAB${utf8ToBase64(`${C_ADDRESS}:${req.payTo}:${amount}`)}`,
    },
  };
  return utf8ToBase64(JSON.stringify(envelopePayload));
}

async function defaultSubmitPhase(
  signedHeader: string,
  req: PaymentRequirements
): Promise<void> {
  if (!signedHeader) {
    throw new Error("Missing PAYMENT-SIGNATURE header in submit phase");
  }
  const paidResponse = new Response('{"ok":true}', {
    status: 200,
    headers: {
      "PAYMENT-RESPONSE": b64({
        success: true,
        transaction: "a".repeat(64),
        network: req.network,
        payer: PAYTO,
      }),
    },
  });
  const settled = decodeSettlementHeader(paidResponse);
  if (!settled || !settled.transaction) {
    throw new Error("Facilitator fixture failed to return valid settlement header");
  }
}

/**
 * Run the repeatable x402 payment flow benchmark (`quote` -> `sign` -> `submit`)
 * and compute per-phase wall-clock timing statistics.
 */
export async function runX402PhaseBenchmark(
  options: X402BenchmarkOptions = {}
): Promise<X402BenchmarkRunResult> {
  const iterations = options.iterations ?? 10;
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new RangeError("iterations must be a positive integer");
  }

  const nowMs = options.nowMs ?? (() => performance.now());
  const quoteFn = options.quotePhase ?? defaultQuotePhase;
  const signFn = options.signPhase ?? defaultSignPhase;
  const submitFn = options.submitPhase ?? defaultSubmitPhase;

  const samples: X402PhaseSample[] = [];

  for (let i = 0; i < iterations; i++) {
    const t0 = nowMs();
    const quoted = await quoteFn(i);
    const t1 = nowMs();
    const signedHeader = await signFn(quoted, i);
    const t2 = nowMs();
    await submitFn(signedHeader, quoted, i);
    const t3 = nowMs();

    const quoteMs = Math.max(0, t1 - t0);
    const signMs = Math.max(0, t2 - t1);
    const submitMs = Math.max(0, t3 - t2);
    const totalMs = Math.max(0, t3 - t0);

    samples.push({
      iteration: i + 1,
      quoteMs: roundMetric(quoteMs),
      signMs: roundMetric(signMs),
      submitMs: roundMetric(submitMs),
      totalMs: roundMetric(totalMs),
    });
  }

  const quoteStats = computePhaseStats(samples.map((s) => s.quoteMs));
  const signStats = computePhaseStats(samples.map((s) => s.signMs));
  const submitStats = computePhaseStats(samples.map((s) => s.submitMs));
  const totalStats = computePhaseStats(samples.map((s) => s.totalMs));
  const signToSubmitSamples = samples.map((s) => s.signMs + s.submitMs);
  const signToSubmitP95Ms = computePhaseStats(signToSubmitSamples).p95Ms;

  const v13ViableWindowMs =
    X402_LATENCY_AUDIT_CONSTANTS.MIN_VIABLE_EXPIRATION_LEDGERS *
    X402_LATENCY_AUDIT_CONSTANTS.ESTIMATED_LEDGER_SECONDS *
    1000;

  const v13HeadroomRatio = roundMetric(
    v13ViableWindowMs / Math.max(0.001, signToSubmitP95Ms)
  );
  const withinV13Floor = signToSubmitP95Ms < v13ViableWindowMs;

  const record: X402BenchmarkRecord = {
    version: options.version ?? "0.6.2",
    timestamp: new Date().toISOString(),
    ...(options.commit ? { commit: options.commit } : {}),
    iterations,
    environment: `node-${process.version}`,
    phases: {
      quote: quoteStats,
      sign: signStats,
      submit: submitStats,
      total: totalStats,
    },
    auditComparison: {
      signToSubmitP95Ms,
      v13ViableWindowMs,
      v13HeadroomRatio,
      withinV13Floor,
    },
  };

  let passed = withinV13Floor;
  let regressionReason: string | undefined;

  if (!withinV13Floor) {
    regressionReason =
      `sign+submit p95 latency (${signToSubmitP95Ms}ms) exceeded V-13 viable expiration floor ` +
      `(${v13ViableWindowMs}ms / ${X402_LATENCY_AUDIT_CONSTANTS.MIN_VIABLE_EXPIRATION_LEDGERS} ledgers)`;
  } else if (
    options.maxTotalP95Ms !== undefined &&
    totalStats.p95Ms > options.maxTotalP95Ms
  ) {
    passed = false;
    regressionReason =
      `Total x402 benchmark p95 (${totalStats.p95Ms}ms) exceeded configured budget (${options.maxTotalP95Ms}ms)`;
  }

  return {
    record,
    samples,
    passed,
    ...(regressionReason ? { regressionReason } : {}),
  };
}

/**
 * Append a benchmark record to an append-only `.jsonl` history file without
 * modifying or truncating any existing lines.
 */
export function appendBenchmarkRecord(
  historyFilePath: string,
  record: X402BenchmarkRecord
): void {
  const dir = path.dirname(historyFilePath);
  fs.mkdirSync(dir, { recursive: true });
  const serialized = JSON.stringify(record) + "\n";
  fs.appendFileSync(historyFilePath, serialized, "utf8");
}

/**
 * Read and parse all historical benchmark records from a `.jsonl` history file.
 */
export function readBenchmarkHistory(
  historyFilePath: string
): X402BenchmarkRecord[] {
  if (!fs.existsSync(historyFilePath)) {
    return [];
  }
  const raw = fs.readFileSync(historyFilePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, idx) => {
      try {
        return JSON.parse(line) as X402BenchmarkRecord;
      } catch (err) {
        throw new Error(
          `Invalid JSON on line ${idx + 1} of ${historyFilePath}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    });
}
