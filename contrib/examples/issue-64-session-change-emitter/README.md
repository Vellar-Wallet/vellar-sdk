# Session Change Emitter

A self-contained example module implementing a simple event emitter that
notifies subscribers whenever a wallet session value changes.

Contributed for [issue #64](https://github.com/Vellar-Wallet/vellar-sdk/issues/64).

---

## Overview

`session-change-emitter.ts` exposes a factory function `createSessionEmitter`
that returns an object with three methods:

| Method | Description |
|---|---|
| `subscribe(handler)` | Register a callback invoked on every session change. Returns an `unsubscribe` function. |
| `setSession(newSession)` | Update the current session and notify all active subscribers. |
| `getSession()` | Return the current session value without triggering notifications. |

Multiple subscribers are supported; each receives the same `(newSession, prevSession)` tuple.

---

## Usage

```ts
import { createSessionEmitter } from "./session-change-emitter";

const emitter = createSessionEmitter();

// Subscribe — returns an unsubscribe function
const unsubscribe = emitter.subscribe((newSession, prevSession) => {
  console.log("Session changed");
  console.log("  previous:", prevSession);
  console.log("  current: ", newSession);
});

// Trigger a change
emitter.setSession({ userId: "alice", token: "tok-xyz" });
// → Session changed
//     previous: null
//     current:  { userId: 'alice', token: 'tok-xyz' }

// Update again
emitter.setSession({ userId: "alice", token: "tok-new" });
// → Session changed
//     previous: { userId: 'alice', token: 'tok-xyz' }
//     current:  { userId: 'alice', token: 'tok-new' }

// Stop receiving updates
unsubscribe();

emitter.setSession(null); // subscriber is silent now
```

---

## Running the tests

The tests use [vitest](https://vitest.dev/), which is already a dev dependency of the repo.

```bash
# Run just this example's tests (from the repo root)
npx vitest run contrib/examples/issue-64-session-change-emitter/session-change-emitter.test.ts
```

Or run the entire project test suite (includes these tests automatically):

```bash
npm test
```

Expected output:

```
 ✓ contrib/examples/issue-64-session-change-emitter/session-change-emitter.test.ts (7)
   ✓ createSessionEmitter > initial session is null
   ✓ createSessionEmitter > subscriber receives the new session value
   ✓ createSessionEmitter > subscriber receives the previous session as the second argument
   ✓ createSessionEmitter > multiple subscribers all receive the same update
   ✓ createSessionEmitter > unsubscribe stops the handler from receiving further updates
   ✓ createSessionEmitter > unsubscribing one subscriber does not affect others
   ✓ createSessionEmitter > setSession with null clears the session
   ✓ createSessionEmitter > getSession reflects the latest value without triggering notifications

 Test Files  1 passed (1)
 Tests       8 passed (8)
```

---

## File structure

```
contrib/examples/issue-64-session-change-emitter/
├── README.md                        ← you are here
├── session-change-emitter.ts        ← the module
└── session-change-emitter.test.ts   ← tests / demo script
```
