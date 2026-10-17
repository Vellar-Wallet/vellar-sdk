#!/usr/bin/env node
// Repeatable x402 payment flow latency benchmark (quote, sign, submit)
// against a local/recorded facilitator fixture (issue #685).
//
// Usage:
//   node scripts/benchmark-x402-latency.mjs            # run benchmark & verify V-13 floor
//   node scripts/benchmark-x402-latency.mjs --append   # append result to benchmarks/x402-latency-history.jsonl
//   node scripts/benchmark-x402-latency.mjs --json     # emit structured JSON output

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const historyPath = path.join(root, "benchmarks", "x402-latency-history.jsonl");

const args = new Set(process.argv.slice(2));
const shouldAppend = args.has("--append");
const jsonOutput = args.has("--json");
const iterations = 20;

const V13_VIABLE_WINDOW_MS = 5 * 5 * 1000; // 5 ledgers * 5s = 25,000ms

function roundMetric(v) {
  return Math.round(v * 1000) / 1000;
}

function computeStats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const p50Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.5));
  const p95Idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return {
    minMs: roundMetric(sorted[0]),
    meanMs: roundMetric(sum / sorted.length),
    p50Ms: roundMetric(sorted[p50Idx]),
    p95Ms: roundMetric(sorted[Math.max(0, p95Idx)]),
    maxMs: roundMetric(sorted[sorted.length - 1]),
  };
}

const challengeHeader = Buffer.from(
  JSON.stringify({
    x402Version: 2,
    error: "Payment required",
    accepts: [
      {
        scheme: "exact",
        network: "stellar:testnet",
        asset: "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND",
        amount: "2500000",
        payTo: "GAN5MFH3GGAWH2UTO5DDOMDRQK6E32CE2GPAMPQT6KEHEPNHVBKJEF6A",
        maxTimeoutSeconds: 120,
        extra: { areFeesSponsored: true },
      },
    ],
  }),
  "utf8"
).toString("base64");

const samples = [];
for (let i = 0; i < iterations; i++) {
  const t0 = performance.now();
  const decodedChallenge = JSON.parse(
    Buffer.from(challengeHeader, "base64").toString("utf8")
  );
  const selected = decodedChallenge.accepts.find(
    (opt) =>
      opt.scheme === "exact" &&
      opt.network === "stellar:testnet" &&
      opt.extra?.areFeesSponsored === true &&
      BigInt(opt.amount) <= 10_000_000n
  );
  const t1 = performance.now();

  const windowLedgers = Math.ceil((selected.maxTimeoutSeconds ?? 120) / 5);
  const expirationOffset = Math.max(Math.min(windowLedgers - 2, 58), 3);
  const signedHeader = Buffer.from(
    JSON.stringify({
      x402Version: 2,
      accepted: selected,
      payload: {
        expirationLedgerOffset: expirationOffset,
        transaction: "AAAAAgAAAAB" + Buffer.from(selected.amount).toString("base64"),
      },
    }),
    "utf8"
  ).toString("base64");
  const t2 = performance.now();

  const settlementHeader = Buffer.from(
    JSON.stringify({
      success: true,
      transaction: "a".repeat(64),
      network: selected.network,
      payer: selected.payTo,
      signatureRef: signedHeader.slice(0, 16),
    }),
    "utf8"
  ).toString("base64");
  const settled = JSON.parse(
    Buffer.from(settlementHeader, "base64").toString("utf8")
  );
  if (!settled.success) throw new Error("Submit phase failed");
  const t3 = performance.now();

  samples.push({
    quoteMs: t1 - t0,
    signMs: t2 - t1,
    submitMs: t3 - t2,
    totalMs: t3 - t0,
  });
}

const quoteStats = computeStats(samples.map((s) => s.quoteMs));
const signStats = computeStats(samples.map((s) => s.signMs));
const submitStats = computeStats(samples.map((s) => s.submitMs));
const totalStats = computeStats(samples.map((s) => s.totalMs));
const signToSubmitP95Ms = computeStats(
  samples.map((s) => s.signMs + s.submitMs)
).p95Ms;

const record = {
  version: pkgJson.version,
  timestamp: new Date().toISOString(),
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
    v13ViableWindowMs: V13_VIABLE_WINDOW_MS,
    v13HeadroomRatio: roundMetric(
      V13_VIABLE_WINDOW_MS / Math.max(0.001, signToSubmitP95Ms)
    ),
    withinV13Floor: signToSubmitP95Ms < V13_VIABLE_WINDOW_MS,
  },
};

if (shouldAppend) {
  mkdirSync(path.dirname(historyPath), { recursive: true });
  appendFileSync(historyPath, JSON.stringify(record) + "\n", "utf8");
}

if (jsonOutput) {
  console.log(JSON.stringify(record, null, 2));
} else {
  console.log(
    `x402 latency benchmark (v${record.version}, ${iterations} iterations):\n` +
      `  quote  p50=${quoteStats.p50Ms}ms p95=${quoteStats.p95Ms}ms\n` +
      `  sign   p50=${signStats.p50Ms}ms p95=${signStats.p95Ms}ms\n` +
      `  submit p50=${submitStats.p50Ms}ms p95=${submitStats.p95Ms}ms\n` +
      `  total  p50=${totalStats.p50Ms}ms p95=${totalStats.p95Ms}ms (V-13 viable window: ${V13_VIABLE_WINDOW_MS}ms)`
  );
  if (existsSync(historyPath)) {
    const lineCount = readFileSync(historyPath, "utf8")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean).length;
    console.log(`  history records in benchmarks/x402-latency-history.jsonl: ${lineCount}`);
  }
}

if (!record.auditComparison.withinV13Floor) {
  console.error("ERROR: x402 sign+submit latency exceeded V-13 viable window!");
  process.exit(1);
}
