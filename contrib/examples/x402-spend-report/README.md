# x402 spend report generator

Generates a spend report from a list of completed x402 settlements
(`X402Settlement`, `src/x402-types.ts`), grouped by asset with per-asset
totals, plus an overall settlement count.

## The flow

1. `generateSpendReport(settlements)` groups settlements by `asset`,
   summing `amount` per group and counting settlements per group.
2. The result's `byAsset` array is sorted alphabetically by asset for a
   stable, readable report.
3. `totalSettlements` reports the overall count across every asset, so a
   reader can see both the aggregate and the per-asset breakdown at once.

## Run it

```sh
npx tsx x402-spend-report.ts
```

Expected output (4 sample settlements, two of them in CUSDC):

```
Total settlements: 4

CAQUA: 750000 (1 settlement)
CNATIVE: 50000000 (1 settlement)
CUSDC: 3500000 (2 settlements)
```

## Tests

```sh
npx vitest run contrib/examples/x402-spend-report
```
