# x402 Payment Flow Latency Benchmarks

This document explains how `vellar-sdk` measures end-to-end x402 payment flow latency across releases (`src/x402-benchmark.ts` and `scripts/benchmark-x402-latency.mjs`), how results are recorded in `benchmarks/x402-latency-history.jsonl`, and how those measurements relate to the security audit's expiration floor (`V-13`) and signature lifetime ceiling (`V-7`).

## 1. Benchmark Phases

Every benchmark run executes the three phases of an x402 payment against a recorded facilitator fixture and measures wall-clock time (`quoteMs`, `signMs`, `submitMs`, `totalMs`):

1. **`quote` Phase**: Sends the initial probe request, receives the `402 Payment Required` challenge, decodes `PAYMENT-REQUIRED` via `decodePaymentRequired`, and selects the matching Stellar option via `selectRequirements` (enforcing `maxAmount`, `allowedAssets`, CAIP-2 network, and fee sponsorship).
2. **`sign` Phase**: Computes the signature expiration ledger offset via `expirationOffsetFor`, validates authorization entry parameters, signs the SEP-41 transfer invocation, and encodes the `PAYMENT-SIGNATURE` header.
3. **`submit` Phase**: Replays the request carrying `PAYMENT-SIGNATURE`, verifies the `200 OK` response, and decodes the on-chain settlement receipt from `PAYMENT-RESPONSE` via `decodeSettlementHeader`.

## 2. Relationship to Security Audit Constants (`V-7` and `V-13`)

In [`docs/security-audit.md`](./security-audit.md), two findings directly depend on measured x402 settlement latency:

| Constant | Value | Equivalent Window (`~5s` ledgers) | Audit Reference & Meaning |
| :--- | :--- | :--- | :--- |
| `ESTIMATED_LEDGER_SECONDS` | `5s` | 1 ledger | Baseline Stellar ledger close interval used to convert `maxTimeoutSeconds` into ledger offsets. |
| `EXPIRATION_SAFETY_MARGIN` | `2 ledgers` | `~10s` | Subtracted from `ceil(maxTimeoutSeconds / 5)` so the payer's expiration stays inside the facilitator's `maxLedger` window despite clock/ledger read drift. |
| `MIN_EXPIRATION_LEDGERS` | `3 ledgers` | `~15s` | Hard floor in `src/x402-client.ts`. Against a live facilitator, the measured worst-case sign-to-settled latency was **12.0s** (typical **8.0s**), leaving only ~3s of headroom. |
| `MIN_VIABLE_EXPIRATION_LEDGERS` | `5 ledgers` | `~25s` | **Finding V-13 fix**: `packages/mcp-x402-payer` refuses challenges whose timeout yields fewer than 5 ledgers (~25s, or >2× the 12.0s measured worst-case settlement latency) with `UnworkableTimeoutError` before signing. |
| `DEFAULT_MAX_EXPIRATION_LEDGERS` | `58 ledgers` | `~290s` (`300s - 10s`) | **Finding V-7 fix**: Caps seller-requested signature lifetime at 300s (~25× the 12.0s worst case) unless overridden via `expirationLedgerOffset`. |

## 3. Running & Recording Release Benchmarks

Run the hermetic benchmark suite locally or on release branches:

```bash
# Run the benchmark and verify p95 latency stays within the V-13 viable window
npm run bench:x402

# Append a new release measurement to benchmarks/x402-latency-history.jsonl
node scripts/benchmark-x402-latency.mjs --append
```

Results are stored in `benchmarks/x402-latency-history.jsonl` as an **append-only** JSON Lines log (one JSON object per release/run) so latency trends across releases remain auditable in git history.
