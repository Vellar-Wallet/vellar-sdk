# Policy dry-run harness

Evaluates a candidate `PolicyDefinition` against a list of sample
transactions and reports pass/fail per transaction, with a human-readable
reason for every failing check — useful for sanity-checking a policy body
before it's ever deployed on-chain.

## Checks applied

For each transaction, in the order given:

1. **Signer threshold** — `policy.threshold` vs. the transaction's `signerCount`.
2. **Per-transaction limit** — `policy.spendingLimits.perTxXlm`.
3. **Daily limit** — `policy.spendingLimits.dailyXlm`, tracked as a **running
   total across the whole batch** in array order. A transaction that's fine
   on its own can still fail here once earlier transactions in the batch have
   used up the daily allowance.
4. **Contract allowlist** — `policy.allowlistedContracts`, only checked when
   the transaction has a `contractId` and the policy defines a non-empty list.

A check that the policy doesn't define (e.g. no `threshold` field) is simply
skipped. A transaction can fail more than one check at once — every failing
reason is reported, not just the first.

## Run it

```sh
npx tsx policy-dry-run-harness.ts
```

Expected output, against the sample policy (threshold 2, 200 XLM/tx, 500
XLM/day, one allowlisted contract) and four sample transactions:

```
tx-1: PASS
tx-2: FAIL
  - Amount 250 XLM exceeds per-transaction limit of 200 XLM
tx-3: FAIL
  - Requires 2 signer(s); transaction has 1
tx-4: FAIL
  - Cumulative spend 680 XLM (including this transaction) exceeds daily limit of 500 XLM
  - Contract CUNKNOWNCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX is not in the allowlist [CALLOWEDCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX]
```

## Tests

```sh
npx vitest run contrib/examples/policy-dry-run-harness
```
