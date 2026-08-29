# Multi-asset balance summary

Formats a readable "SYMBOL: amount" summary line per asset from a sample
array of balances across several assets (`vellar-sdk`'s `TokenBalance` shape,
`src/balances.ts`), sorted alphabetically by asset code. Reuses the SDK's
own `formatTokenAmount` for the amount formatting.

## Run it

```sh
npx tsx multi-asset-summary.ts
```

Expected output:

```
With balances:
AQUA: 50000
USDC: 250
XLM: 1000

With no balances:
No balances.
```

An empty balances array prints a clear "No balances." message instead of an
empty output.

## Tests

```sh
npx vitest run contrib/examples/multi-asset-summary
```
