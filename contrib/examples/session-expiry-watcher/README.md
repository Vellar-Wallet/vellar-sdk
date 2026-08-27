# session-expiry-watcher

A small, self contained module that watches a session object with an
`expiresAt` timestamp and invokes a callback shortly before it expires,
using a single `setTimeout` timer.

## Usage

```ts
import { SessionExpiryWatcher } from "./session-expiry-watcher";

const watcher = new SessionExpiryWatcher(
  { expiresAt: Date.now() + 60_000 },
  {
    warnBeforeMs: 10_000, // fire 10s before expiry
    onExpiringSoon: (session) => {
      console.log("Session expiring soon:", session.expiresAt);
    },
  },
);

watcher.start();

// Later, e.g. on logout or component unmount:
watcher.stop();
```

## API

```ts
new SessionExpiryWatcher(session: SessionLike, options: SessionExpiryWatcherOptions)
```

- `session.expiresAt` — epoch milliseconds when the session expires.
- `options.warnBeforeMs` — how many milliseconds before expiry to fire the
  callback.
- `options.onExpiringSoon` — called once, shortly before expiry.
- `options.now` — optional clock override, useful for tests.

Methods:

- `watcher.start()` — starts (or restarts) the timer.
- `watcher.stop()` — clears the timer; safe to call multiple times.
- `watcher.isRunning` — whether a timer is currently scheduled.

If `expiresAt - warnBeforeMs` is already in the past, the callback fires on
the next tick.

## Demo

`demo.ts` creates a session with a 2 second lifetime and a 1 second warning
window, then logs when the callback fires:

```sh
npx tsx demo.ts
# Starting watcher, expect a warning in ~1s...
# Session expiring soon at 2026-07-27T12:00:01.000Z
```
