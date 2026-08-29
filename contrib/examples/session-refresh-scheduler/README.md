# Session refresh scheduler

A self-rescheduling timer that refreshes a wallet session shortly **before** it
is due to expire, then re-arms itself against the expiry of the session the
refresh returns. Mock-driven and timer-based — no network.

A real Vellar session (`WalletSession` in `vellar-sdk`'s `src/types.ts`) tracks
`createdAt` / `lastActiveAt`; an app that mints short-lived x402 session keys
layers an expiry on top. This example models that expiry with an `expiresAt` ISO
timestamp so a long-running agent never presents an expired key.

## Flow

1. `startRefreshScheduler(session, refresh, { leadTimeMs })` computes when the
   session expires and arms a timer for `leadTimeMs` **before** that moment.
2. When the timer fires it calls your `refresh()` function, which returns the
   next session (a freshly minted key with a later `expiresAt`).
3. The scheduler re-arms itself against the **new** expiry — repeating for as
   long as the process runs.
4. `stop()` clears any pending timer so nothing fires after you tear down.

Edge cases handled:

- If the session already expires within the lead time, the refresh fires
  immediately (the delay is clamped to `0`).
- A `refresh()` that throws is reported via `onError` and ends the loop rather
  than crashing the timer.
- An invalid `expiresAt` on the initial session throws synchronously.

## Run it

```sh
npx tsx session-refresh-scheduler.ts
```

Uses a mock that mints 400ms sessions and refreshes 150ms before each expiry,
so you can watch it reschedule a couple of times before it stops:

```
Starting scheduler (lifetime 400ms, refresh 150ms before expiry)
[mint]    session #1 expires at 2026-01-01T00:00:00.400Z
[refresh] refreshing session #1 before it expires
[mint]    session #2 expires at 2026-01-01T00:00:00.650Z
[refresh] refreshing session #2 before it expires
[mint]    session #3 expires at 2026-01-01T00:00:00.900Z
[stop]    scheduler stopped after 3 generations
```

## Tests

Uses Vitest fake timers (`vi.advanceTimersByTimeAsync`) so the reschedule is
observed deterministically with no real delays:

```sh
npx vitest run contrib/examples/session-refresh-scheduler
```
