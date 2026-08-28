# Percentage of Amount Example (#109)

Provides a utility `percentageOf` that computes a given percentage of a base unit token amount (such as Stellar stroops), returning a `bigint` result. Uses basis points (1% = 100 bps) to prevent floating-point precision loss.

## Edge Cases

- **0%**: Handled as an explicit edge case returning `0n`.
- **100%**: Handled as an explicit edge case returning the exact `BigInt(amount)`.

## Examples & Expected Outputs

| Base Amount (Stroops) | Percentage | Expected Result (BigInt Stroops) | Notes |
| --- | --- | --- | --- |
| `10000000` | `0%` | `0` | 0% Edge case |
| `10000000` | `100%` | `10000000` | 100% Edge case |
| `10000000` | `5%` | `500000` | 5% of 10 XLM |
| `10000000` | `2.5%` | `250000` | Fractional fee (250 bps) |
| `500000000` | `0.5%` | `2500000` | Protocol fee (50 bps) |
| `100` | `50%` | `50` | 50% of 100 units |

## Run it

```sh
npx tsx contrib/examples/percentage-of-amount/percentage-of-amount.ts
```

## Tests

```sh
npx vitest run contrib/examples/percentage-of-amount
```
