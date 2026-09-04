# Auto-refresh session manager (capstone)

A single exported `AutoRefreshManager` class that composes three concerns into
one cohesive component so a long-running agent's session is transparently
refreshed **before** it would ever expire:

| concern       | responsibility                              | related example |
| ------------- | ------------------------------------------- | --------------- |
| **store**     | holds the current session                   | [`memory-session-store`](../memory-session-store/) |
| **watcher**   | is it expired / how long left               | [`session-expiry-check`](../session-expiry-check/) |
| **scheduler** | refresh just before expiry, then reschedule | [`session-refresh-scheduler`](../session-refresh-scheduler/) (issue #74) |

It reuses vellar-sdk's real [`WalletSession`](../../../src/types.ts) and layers
an `expiresAt` on top — the SDK's `WalletSession` tracks activity timestamps; an
app that mints short-lived x402 session keys adds the expiry this manager
schedules against.

## API

```ts
const manager = new AutoRefreshManager({
  leadTimeMs: 150,                 // refresh this long before expiry
  refresh: async (previous) => mintNextSession(previous), // rotate the key
});

manager.start(initialSession);     // store + arm the scheduler
manager.getSession();              // current session (store)
manager.isExpired();               // has it lapsed? (watcher)
manager.msUntilExpiry();           // time left in ms (watcher)
manager.stop();                    // clear the pending timer (scheduler)
```

## Flow

1. `start(session)` stores the session and arms a timer for `leadTimeMs` before
   its `expiresAt`.
2. When the timer fires, `refresh(previous)` mints the next session; the manager
   updates the store and re-arms against the **new** expiry.
3. Because each refresh precedes expiry, `isExpired()` stays `false` the whole
   time the manager runs — even past the point where the original session would
   have lapsed.
4. `stop()` clears the pending timer.

## Run it

```sh
npx tsx auto-refresh-manager.ts
```

```
Starting manager (lifetime 400ms, refresh 150ms before expiry)
[start]   session key-1, expires 2026-01-01T00:00:00.400Z
[poll]    key=key-1 expired=false msLeft=150
[refresh] rotating key-1 -> key-2 before expiry
[poll]    key=key-2 expired=false msLeft=300
[refresh] rotating key-2 -> key-3 before expiry
[poll]    key=key-3 expired=false msLeft=150
[poll]    key=key-3 expired=false msLeft=300
[stop]    stopped after 3 generations; final key=key-3
```

## Tests

Uses Vitest fake timers to prove the session stays live past the original
expiry because it was refreshed in time:

```sh
npx vitest run contrib/examples/auto-refresh-manager
```
