# Session budget dashboard source

A data source function, `buildSessionBudgetDashboardSource()`, that
combines a mock session with a mock x402 budget tracker into a single flat
object — session expiry info alongside remaining budget and recent spend —
suitable for feeding a dashboard UI.

## Returned shape

```ts
interface SessionBudgetDashboardSource {
  accountId: string;
  sessionExpiresAt: string;      // ISO timestamp, from the session
  sessionStatus: "active" | "expiring_soon" | "expired";
  totalBudget: bigint;           // from the budget tracker
  remainingBudget: bigint;       // totalBudget - spent
  recentSpend: { amount: bigint; at: string }[];
}
```

`sessionStatus` is computed the same way as the `session-key-dashboard-source`
example, given a simulated "now" (defaults to the real current time, but the
demo and tests pass a fixed one for reproducibility):

- **`expired`** — expiry is at or before now.
- **`expiring_soon`** — expiry is within the next 24 hours.
- **`active`** — expiry is more than 24 hours out.

`remainingBudget` is simply `totalBudget - spent`; `recentSpend` is carried
through from the input budget tracker unchanged.

## Usage

```ts
import { buildSessionBudgetDashboardSource } from "./session-budget-dashboard-source";

const source = buildSessionBudgetDashboardSource(
  { accountId: "CACCOUNT...", expiresAt: "2026-07-01T00:00:00.000Z" },
  { totalBudget: 1_000_000n, spent: 400_000n, recentSpend: [{ amount: 400_000n, at: "2026-06-15T10:00:00.000Z" }] },
);
// { accountId, sessionExpiresAt, sessionStatus: "active", totalBudget: 1000000n, remainingBudget: 600000n, recentSpend: [...] }
```

## Run it

```sh
npx tsx session-budget-dashboard-source.ts
```

Expected output (against a fixed `now` of `2026-06-15T12:00:00.000Z`, with
a session expiring 8 hours later):

```
Account: CDASHBOARDDEMOACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
Session: expiring_soon (expires 2026-06-15T20:00:00.000Z)
Budget: 350000 remaining of 1000000
Recent spend:
  300000 at 2026-06-15T09:00:00.000Z
  350000 at 2026-06-15T11:30:00.000Z
```

## Tests

```sh
npx vitest run contrib/examples/session-budget-dashboard-source
```
