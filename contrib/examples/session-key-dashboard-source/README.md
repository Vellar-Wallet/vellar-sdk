# Session key expiry dashboard source

A data source function, `buildSessionKeyDashboard()`, that lists several
mock session keys with a computed expiry status — `active`,
`expiring_soon`, or `expired` — suitable for feeding a dashboard UI.

## Status shape

Given a simulated "now" (defaults to the real current time, but the demo
and tests pass a fixed one for reproducibility):

- **`expired`** — expiry is at or before now.
- **`expiring_soon`** — expiry is within the next 24 hours.
- **`active`** — expiry is more than 24 hours out.

## Run it

```sh
npx tsx session-key-dashboard-source.ts
```

Expected output (three sample keys, one in each state, against a fixed
`now` of `2026-06-15T12:00:00.000Z`):

```
sk_active (CACTIVE): active — expires 2026-07-01T00:00:00.000Z
sk_expiring_soon (CEXPIRINGSOON): expiring_soon — expires 2026-06-15T20:00:00.000Z
sk_expired (CEXPIRED): expired — expires 2026-06-01T00:00:00.000Z
```

## Tests

```sh
npx vitest run contrib/examples/session-key-dashboard-source
```
