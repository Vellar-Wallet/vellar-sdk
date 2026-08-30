# x402 payment cost estimator

Estimates the total cost of a series of *planned* x402 payments (see
`src/x402-types.ts` for the real `PaymentRequirements` shape this mirrors)
against a mock price feed, converted to a single reference currency — before
any of the payments are actually made. Useful for an agent to budget-check a
batch of planned requests up front, e.g. against an
`x402-budget-tracker`-style allowance.

## Usage

```ts
import { estimateCost } from "./x402-cost-estimator";

const estimate = estimateCost([
  { asset: "USDC", amount: "5" },
  { asset: "XLM", amount: "100" },
]);

estimate.totalReferenceCost; // "17" (5 USDC @ $1.00 + 100 XLM @ $0.12)
```

An asset with no entry in the rate table throws rather than silently costing
$0 — the whole point of a cost estimator is a trustworthy number.

## Run it

```sh
npx tsx x402-cost-estimator.ts
```

Expected output:

```
Itemized cost:
  5 USDC -> 5 USD
  2.5 USDC -> 2.5 USD
  100 XLM -> 12 USD
  10 EURC -> 10.8 USD
Total estimated cost: 30.3 USD
```

## Notes on precision

Amounts and rates are multiplied as fixed-point integers (6 decimal places),
never as floats, so the totals never suffer float rounding — the same reason
`src/payments.ts`'s `parseTokenAmount` avoids floats for money. This example
treats every asset at the same fixed scale for simplicity; a real integration
should use each asset's actual on-chain decimals.

## Tests

```sh
npx vitest run contrib/examples/x402-cost-estimator
```
