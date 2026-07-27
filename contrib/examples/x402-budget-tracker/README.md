# x402 budget tracker for an agent

`X402BudgetTracker` records an agent's successful x402 payments against a
fixed total budget and reports the remaining allowance. A proposed payment
that would exceed what's left is rejected with a clear reason and is never
partially recorded — the tracked spend only changes on approval.

This is a **client-side** guard, the same kind `X402PayOptions.maxAmount`
already is in `src/x402-types.ts` — the durable budget enforcement is the
on-chain spending-limit policy attached to the signing key. This tracker is
useful for an agent that wants to stop making requests *before* hitting that
on-chain wall, e.g. to fail fast with a clear reason instead of discovering
the rejection only after a signed payment bounces off the facilitator.

## Usage

```ts
import { X402BudgetTracker } from "./x402-budget-tracker";

const tracker = new X402BudgetTracker(1_000_000n);

tracker.tryRecordPayment(300_000n); // { approved: true, remainingBudget: 700000n }
tracker.tryRecordPayment(800_000n); // { approved: false, reason: "...", remainingBudget: 700000n }
```

## Run it

```sh
npx tsx x402-budget-tracker.ts
```

Expected output:

```
Payment of 300000: APPROVED (remaining: 700000)
Payment of 400000: APPROVED (remaining: 300000)
Payment of 500000: REJECTED — Payment of 500000 would exceed remaining budget of 300000 (total 1000000, already spent 700000)
Payment of 200000: APPROVED (remaining: 100000)
```

## Tests

```sh
npx vitest run contrib/examples/x402-budget-tracker
```
