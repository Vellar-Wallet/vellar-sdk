# Balance Change Watcher

A self-contained reference example that polls a balance source on an interval
and emits a change event **only** when the returned value differs from the last
observed value.

## Flow

1. `createBalanceWatcher(source, intervalMs)` starts an interval loop and
   records the first balance silently (no event on the initial read).
2. On every subsequent poll, if the new balance differs from the previous one,
   all registered `ChangeHandler` callbacks are invoked with
   `(newBalance, previousBalance)`.
3. Call `watcher.subscribe(handler)` to register a listener.
4. Call `watcher.stop()` to cancel the interval and end polling.

## Files

| File | Purpose |
|------|---------|
| `balance-change-watcher.ts` | Core `createBalanceWatcher` implementation |
| `demo.ts` | Script with a mock source whose value changes mid-run |

## Running the demo

```bash
npx ts-node demo.ts
```

Expected output (values change at polls 4 and 6):

```
[change] 100.00 → 175.50
[change] 175.50 → 200.00
Watcher stopped.
```
