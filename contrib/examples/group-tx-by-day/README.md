# Group transaction history by day

A standalone example that takes an array of sample transactions with
timestamps and groups them into buckets keyed by calendar day.

## What it does

`groupTransactionsByDay(transactions)` in `group-tx-by-day.ts`:

- Uses each transaction's `timestamp` field (ISO 8601 string) to compute a
  UTC calendar-day key (`YYYY-MM-DD`).
- Returns one group per day, in chronological order — oldest day first.
- Within a day, transactions keep their original input order.

The SDK doesn't ship a dedicated "transaction history" type, so
`SampleTransaction` here is a minimal shape (`hash`, `timestamp`, `amount`,
`status`) combining an ISO timestamp with `TxStatus` from
`src/tx-status.ts`, the pattern a wallet activity feed would typically use.

The bundled `SAMPLE_TRANSACTIONS` span three different days
(2026-07-20, 2026-07-22, and 2026-07-25/26) to exercise the day boundary.

## Run it

```sh
npx tsx contrib/examples/group-tx-by-day/group-tx-by-day.ts
```

## Test it

```sh
npm test -- contrib/examples/group-tx-by-day
```
