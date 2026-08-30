# Debounce a balance refresh call

Debounces repeated calls to a mock `refreshBalance` function so only the
last call in a burst actually runs, after the burst goes quiet for
`delayMs`.

## Where this helps in a wallet UI

A balance display that refetches on every relevant event (a poll tick, a
websocket update, a tab regaining focus, a user hitting "refresh" a few
times) can trigger a burst of near-simultaneous refresh calls. Debouncing
collapses that burst into a single network request — instead of firing 5
redundant balance reads for a single user action, only the last one runs.

## Run it

```sh
npx tsx debounce-refresh.ts
```

Expected output (5 rapid calls collapse into 1 actual refresh):

```
Firing 5 rapid calls in a burst...
refreshBalance called (call #1) for CACCOUNTSAMPLEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
Total actual refreshes: 1 (expected 1, despite 5 calls)
```

## Tests

Uses vitest's fake timers, so the tests run instantly with no real delays:

```sh
npx vitest run contrib/examples/debounce-refresh
```
