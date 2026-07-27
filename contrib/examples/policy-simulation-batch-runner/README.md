# Policy simulation batch runner

Simulates a candidate spending-limit policy against a batch of sample
transactions all at once — a local evaluation (no network call) against the
policy's `spendingLimits` and `allowlistedContracts` — and summarizes total
pass/fail counts with a reason for each failure.

## How it evaluates a transaction

For each transaction, in this order:

1. **Per-transaction limit** — fails if `amountXlm` exceeds
   `spendingLimits.perTxXlm`.
2. **Allowlist** — fails if the transaction has a `contractId` and
   `allowlistedContracts` is set but doesn't include it.
3. **Cumulative daily limit** — fails if adding this transaction's amount to
   the running daily total (of previously *passed* transactions only) would
   exceed `spendingLimits.dailyXlm`.

A failed transaction's amount is never added to the running daily total —
only passed transactions accumulate.

## Run it

```sh
npx tsx batch-runner.ts
```

Expected output (5 sample transactions against a 200 XLM per-tx / 300 XLM
daily / one-contract-allowlist policy):

```
Batch summary: 2/5 passed, 3/5 failed
  FAIL tx-2: amount 250 XLM exceeds per-transaction limit 200 XLM
  FAIL tx-3: contract CNOTALLOWLISTEDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX is not in the allowlisted contracts
  FAIL tx-5: cumulative daily total 350.00 XLM would exceed daily limit 300 XLM
```

## Tests

```sh
npx vitest run contrib/examples/policy-simulation-batch-runner
```
