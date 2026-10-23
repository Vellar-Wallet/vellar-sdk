# x402 Payment Flow Latency Benchmark (#685)

Reference implementation for a repeatable benchmark measuring end-to-end
x402 payment flow latency (quote, sign, submit phases) against a local
fixture, so a regression is caught before it reaches a documented latency
claim.

## What It Does

- Times the three real seams the x402 payer flow already exposes via
  dependency injection, rather than refactoring production call structure:
  - **quote**: the initial, unpaid probe that returns the 402 challenge
    (`Payer.quote()` in `packages/mcp-x402-payer/src/payer.ts`).
  - **sign**: the signer's work building a fresh signed payment payload
    (`PayerDeps.signer.signPayment()`).
  - **submit**: the paid retry request carrying the `X-PAYMENT` header
    (`PayerDeps.fetchImpl()` on the retried call).
- `createLocalFixture()` is a minimal local stand-in implementing the real
  402-challenge-then-paid-retry shape, with configurable per-phase delays,
  so the benchmark runs without a real facilitator, real network, or real
  signing key.
- `runBenchmark()` runs several iterations and reports the **median** per
  phase (not the mean), so one cold-start or GC-pause outlier in a small
  sample doesn't dominate the reported number.
- `recordBenchmarkResult()` appends one NDJSON line per run to a committed,
  append-only results file, so latency trends are visible across releases
  by diffing or plotting that file over time, rather than a single
  overwritten snapshot.

## Verification (manually run, see note on CI below)

```
PASS quote-timing
PASS sign-timing
PASS submit-timing
PASS total-roughly-sums
PASS iterations
PASS median-positive
PASS appends-ndjson
PASS ndjson-valid-json
PASS quote-is-402
PASS headers-has-xpayment
PASS paid-is-200
ALL PASS
```

## How this relates to the expiration floor and other latency-sensitive constants

The security audit's V-13 finding (`packages/mcp-x402-payer/src/smart-account-scheme.ts`)
defines the smallest signature window the payer will accept before refusing
to sign. If the real sign-phase latency (the `signMs` this benchmark
measures) ever grows close to that floor under real conditions, a
legitimately-slow signer (a hardware wallet, a remote KMS call, a busy
process) could start failing the V-13 check in production even though
nothing is actually wrong, a false "window too short" rejection caused by
the payer's own latency rather than an attacker's.

This benchmark's purpose, once wired into CI on release branches, is to
catch a regression that pushes `signMs` (or the other phases, which feed
into overall responsiveness) upward before it reaches that failure mode,
by comparing each release's measured median against prior releases in the
committed results file.

## Integration into Core

1. Copy `benchmark.ts` to `scripts/benchmark-x402-latency.ts` and
   `benchmark.test.ts` to `scripts/benchmark-x402-latency.test.ts`.
2. Add a results file path, e.g. `benchmarks/x402-latency-results.ndjson`,
   committed to the repo (append-only, never force-pushed or rewritten).
3. Add a thin CLI entry that calls `runBenchmark()` with a fixture
   calibrated to resemble real-world phase durations (not the artificial
   5ms defaults used for fast unit tests), then
   `recordBenchmarkResult(result, "benchmarks/x402-latency-results.ndjson")`.
4. Add a root `package.json` script:
   ```json
   "benchmark:x402-latency": "node scripts/benchmark-x402-latency.js"
   ```
5. Wire a CI job that runs only on release branches (not every PR, per the
   issue's own requirement), e.g. a workflow trigger on
   `push: tags: ["v*"]` or a `release` branch pattern, running the benchmark
   and committing the updated results file back, or uploading it as a
   release artifact for later trend analysis.
6. Document the relationship to V-13's signature window (see above) in
   `website/content/docs/security/` alongside the existing audit writeup.
