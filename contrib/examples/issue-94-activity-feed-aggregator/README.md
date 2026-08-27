# Wallet Activity Feed Aggregator

A self-contained reference example that merges payment history and policy change
history into a single chronologically ordered activity feed where every item has
a consistent shape.

## Flow

1. `aggregateFeed(payments, policyChanges)` accepts two arrays of raw records.
2. Each record is normalised into an `ActivityItem` with `id`, `kind`,
   `timestamp`, `summary`, and `meta`.
3. The combined list is sorted **newest first** by `timestamp`.

## Consistent item shape

```ts
interface ActivityItem {
  id: string;
  kind: 'payment' | 'policy_change';
  timestamp: Date;
  summary: string;         // human-readable one-liner
  meta: Record<string, unknown>; // source-specific fields
}
```

## Files

| File | Purpose |
|------|---------|
| `activity-feed-aggregator.ts` | Core `aggregateFeed` implementation |
| `demo.ts` | Script with sample payments and policy changes |

## Running the demo

```bash
npx ts-node demo.ts
```

Expected output (newest first):

```
[2026-07-05T08:15:00.000Z] (payment) Sent 9.99 USDC to GDEF...
[2026-07-04T11:45:00.000Z] (policy_change) Policy pol-42: limit_updated
[2026-07-03T14:30:00.000Z] (payment) Sent 120.00 USDC to GABC...
[2026-07-02T09:00:00.000Z] (policy_change) Policy pol-42: activated
[2026-07-01T10:00:00.000Z] (payment) Sent 50.00 USDC to GBXYZ...
```
