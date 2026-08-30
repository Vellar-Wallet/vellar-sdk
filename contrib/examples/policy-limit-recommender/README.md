# Policy limit recommendation helper

`recommendSpendingLimit()` suggests a spending limit value from a sample of
an account's recent payment history, using a simple percentile-style
calculation plus a headroom multiplier. It's an advisory number for a human
to review before setting a real policy's `spendingLimits` value (see
`src/types.ts`'s `PolicyDefinition`) — not a payment amount itself, so this
example works in plain numbers rather than the fixed-point/bigint arithmetic
other examples use for actual on-chain amounts.

## The calculation

1. Sort the sample ascending.
2. Take the **90th percentile** (nearest-rank method) as the baseline —
   "at or above 90% of past payments". Using a percentile instead of the raw
   maximum means a single unusually large outlier payment doesn't single-handedly
   set the limit.
3. Multiply that baseline by a **1.5x headroom multiplier**, so the
   recommended limit isn't a razor's edge against typical spend.

Both the percentile and the headroom multiplier are configurable via
`RecommendationOptions`.

## Usage

```ts
import { recommendSpendingLimit } from "./policy-limit-recommender";

const recommendation = recommendSpendingLimit([12, 8, 45, 15, 9, 60, 11, 14, 10, 13]);
// {
//   sampleSize: 10,
//   percentile: 90,
//   percentileValue: 45,
//   headroomMultiplier: 1.5,
//   recommendedLimit: 67.5,
// }

// Custom percentile / multiplier:
recommendSpendingLimit(history, { percentile: 75, headroomMultiplier: 2 });
```

Throws for an empty sample, a negative or non-finite amount, or a percentile
outside `(0, 100]` — a silently wrong recommendation would be worse than a
loud failure here.

## Run it

```sh
npx tsx policy-limit-recommender.ts
```

Expected output:

```
Sample: 10 payments
P90 of sample: 45
Headroom multiplier: 1.5x
Recommended spending limit: 67.5
```

## Tests

```sh
npx vitest run contrib/examples/policy-limit-recommender
```
