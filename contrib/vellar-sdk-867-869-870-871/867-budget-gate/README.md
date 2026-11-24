# Pre-payment budget gate (#867)

`budget-gate.ts` exposes `checkBudgetAgainstQuote(quotedPriceStroops,
paymentType, maxBudgetStroops)`. It returns `withinBudget` plus the estimated
fee, the combined total, any shortfall, and a human-readable reason.

This is a pre-payment gate, intended for:

- a human-facing CLI confirmation prompt, where the total can be shown before
  the user approves signing;
- an MCP payer tool call, where the agent can decide not to proceed.

The fee estimate is the documented upper bound for the payment type, read from
`MEASURED_MAX_TX_FEE_STROOPS` in `src/x402-budget-attributes.ts`. No network
call or signature happens in the helper. The comparison is inclusive: a total
exactly equal to the budget is within budget.

## Why it does not call `estimateFeeBidRefusal`

The upstream helper has the same intent but currently cannot be imported: it
imports `MEASURED_FEE_BIDS` and `MeasuredPaymentType` from
`src/x402-budget-attributes.ts`, while that module exports
`MEASURED_MAX_TX_FEE_STROOPS` and `MeasuredFeePaymentType`. This implementation
mirrors the arithmetic against the real constants. A maintainer fixing those
imports can replace the local `estimatedFeeStroops` call with the upstream
helper without changing the public shape of `BudgetCheck`.

## Verification

```sh
npx vitest run contrib/vellar-sdk-867-869-870-871/867-budget-gate
```
