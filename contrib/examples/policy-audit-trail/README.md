# Policy audit trail formatter

`formatAuditTrail(events)` takes a list of policy change events (`create`,
`update`, `remove`) and renders them as a readable chronological audit
trail — **oldest first**. Input order is never assumed to already be
sorted: events are sorted by `timestamp` before rendering, so passing them
in any order (e.g. as fetched newest-first from an API) still produces a
correct trail.

## Input shape

```ts
interface PolicyChangeEvent {
  action: "create" | "update" | "remove";
  policyId: string;
  timestamp: string; // ISO 8601
}
```

Each rendered line includes the action, the policy id, and the timestamp:
`[<timestamp>] <Action> policy (<policyId>)`.

## Run it

```sh
npx tsx policy-audit-trail.ts
```

Expected output (the sample events are given out of order; the trail is
still oldest-first):

```
[2026-01-10T12:00:00Z] Created policy (spending-limit-policy)
[2026-01-20T16:45:00Z] Created policy (signer-threshold-policy)
[2026-02-14T08:30:00Z] Updated policy (signer-threshold-policy)
[2026-03-03T09:15:00Z] Removed policy (spending-limit-policy)
```

## Tests

```sh
npx vitest run contrib/examples/policy-audit-trail
```
