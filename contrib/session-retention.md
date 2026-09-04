# Data retention guidance for cached session state (#292)

Guidance and a reference implementation for how long cached session state should
persist in consumer local storage, and how that window is enforced.

Reference implementation: [contrib/session-retention.ts](session-retention.ts).
Tests: [contrib/session-retention.test.ts](session-retention.test.ts).

---

## 1. What is actually cached

`createSessionStore` (`src/session.ts`) persists a `WalletSession` through a
`SessionStorageAdapter` — `localStorage` on the web, `browser.storage` in an
extension. That record is:

| Field | Sensitivity |
| --- | --- |
| `accountId` | Public. The smart-account (`C...`) address. |
| `keyId` | Public. The passkey's base64url credential id. |
| `network` | Public. |
| `createdAt` / `lastActiveAt` | Timestamps. |
| `serverSessionId` | An opaque server-side record id. |

Getting the severity right matters, because it drives the recommendation in both
directions:

- **It is not a credential.** There is no key material here. Cached session state
  cannot authorize anything on its own — every signature still requires a live
  WebAuthn ceremony against the passkey, which never leaves the authenticator.
  An attacker who reads this record cannot move funds with it.
- **It is a durable link** between a browser profile and an on-chain account.
  Anyone reading it learns which Stellar account this person uses. On a shared or
  long-lived device, that linkage should not persist indefinitely.

So the risk is **privacy and lingering account linkage**, not key compromise.
That is why the recommendation is a bounded window rather than an aggressive
minutes-long expiry.

## 2. Recommended retention window

> **Cached session state should persist no longer than 30 days of inactivity.**
> This is the default (`DEFAULT_SESSION_MAX_AGE_MS`).

30 days is the balance point:

- **Long enough** that "open the app, I'm still signed in" holds for ordinary,
  intermittent use. A shorter default would push users through avoidable passkey
  prompts and train them to click through auth ceremonies — a real security cost.
- **Short enough** that an abandoned browser profile stops pointing at an on-chain
  account within a bounded, documented period.

The window is **idle-based**, not absolute: it is measured from `lastActiveAt`,
which the store's `touch()` refreshes on user activity. An actively used session
keeps renewing; an untouched one ages out. A hard cap on total session lifetime
would force re-authentication on active users for no additional benefit given
that the cached data is not a credential.

### Choosing a different window

| Deployment | Suggested `maxAgeMs` | Why |
| --- | --- | --- |
| Consumer wallet, personal device | 30 days (default) | Balance of convenience and bounded linkage. |
| Shared or family device | 1-7 days | More people can read the profile. |
| Shared kiosk / public terminal | 1-12 hours | Assume the next user is a stranger. |
| Custodial dashboard, treasury tooling | 1-8 hours | Higher-value context; prefer explicit re-auth. |
| Ephemeral storage (memory adapter) | `Infinity` | The storage dies with the tab anyway. |

Shortening the window is always safe; it costs a passkey prompt, not access.

## 3. How the window is enforced

Enforcement happens **on read**. `withSessionRetention` wraps a
`SessionStorageAdapter`; on `load()` it measures the entry's age from
`lastActiveAt` and, if it is past the max age, returns `null` **and clears the
entry from the underlying storage**.

```ts
import { createSessionStore, createWebStorageAdapter } from "vellar-sdk";
import { withSessionRetention } from "./contrib/session-retention.js";

const store = createSessionStore(
  withSessionRetention(createWebStorageAdapter(window.localStorage), {
    // Defaults to 30 days when omitted.
    maxAgeMs: 12 * 60 * 60 * 1000, // 12 hours
  }),
);

await store.getState().restore();
store.getState().status; // "disconnected" if the cached state had aged out
```

Two design points worth stating explicitly:

**Expired state is evicted, not merely ignored.** Returning `null` while leaving
the record in `localStorage` would defeat the purpose: the very entry the window
exists to bound would sit there forever. The wrapper clears it.

**The seam is the adapter, not the store.** Wrapping the adapter means the window
applies to every read path — `restore()` today, plus anything that later loads
through the same adapter — and composes with any adapter (web storage, extension
storage, custom) without the core store needing to know retention exists.

### Edge cases, each covered by a test

| Case | Behavior | Rationale |
| --- | --- | --- |
| Unparseable `lastActiveAt` | Treated as expired, evicted | An age that cannot be bounded is exactly what the window exists to prevent. |
| `lastActiveAt` in the future (clock skew) | Never expired; age clamped at zero | Skew or a doctored entry should not extend expiry, nor cause negative-age nonsense. |
| Underlying `clear()` throws | Read still resolves `null` | Read-only or full storage must not resurrect an expired session or brick startup. |
| Underlying `load()` throws | Error propagates | `restore()` already maps this to `disconnected`; the wrapper must not swallow it. |
| `maxAgeMs: Infinity` | Expiry disabled | Only appropriate when storage is itself ephemeral. |
| `maxAgeMs` zero, negative, or `NaN` | Throws `RangeError` at wiring | A misconfigured window must fail loudly, not silently disable expiry. |
| Stored value is `null` | Passes through, no `clear()` call | Nothing to evict. |

### Relationship to `end()`

Retention does not replace explicit teardown. `end()` still clears storage on
sign-out, and that remains the primary path. The retention window is the backstop
for sessions that are simply never returned to — the abandoned tab, the profile
on a device that changed hands.

## 4. Integration into Core

This is written as a wrapper so it can live in `contrib/`. To land it in the core
SDK:

1. Move `DEFAULT_SESSION_MAX_AGE_MS`, `isSessionExpired`, and the `resolveMaxAgeMs`
   validation from [contrib/session-retention.ts](session-retention.ts) into
   `src/session.ts`, and export the first two from `src/index.ts`.
2. Add `maxAgeMs?: number` to `CreateSessionStoreOptions`, resolving it once at
   the top of `createSessionStore` so a bad value throws at wiring time.
3. In `restore()`, after the `isWalletSession(stored)` check, discard and evict
   when `isSessionExpired(stored, maxAgeMs)`:

   ```ts
   if (isSessionExpired(stored, maxAgeMs)) {
     try {
       await storage.clear();
     } catch {
       // Best-effort eviction; storage failure must not brick startup.
     }
     set({ session: null, status: "disconnected" });
     return;
   }
   ```

4. Port [contrib/session-retention.test.ts](session-retention.test.ts) to
   `src/session.test.ts`.

   > Note: `src/session.test.ts` currently does not parse on `dev` — the
   > `dispose() clears the timer so the store is garbage-collectable` case is
   > missing its closing `});` and a new `describe(` opens immediately after it,
   > so `tsc` reports `TS1005: '}' expected` and vitest fails the file with
   > `Transform failed`. That needs fixing before tests can be added there.
   >
   > Also note that the shared `session` fixture in that file pins `lastActiveAt`
   > to a hardcoded `2026-07-16`. Once a retention window exists, a fixed past
   > timestamp silently ages out as the calendar moves and breaks the `restore()`
   > tests. Make that fixture relative to now.

5. Add the section below to the root `README.md`.

### Proposed README section

Drop this into `README.md` between the `x402` and `Advanced` sections, and add a
`Helpers` table row:

```markdown
| `createSessionStore(storage, opts?)` | Session store with pluggable storage and a retention window - see [Session retention](#session-retention) |
```

---

### Session retention

`createSessionStore` caches session state — the smart-account address, the public
passkey credential id, and `createdAt` / `lastActiveAt` timestamps — through the
storage adapter you give it (`localStorage` on the web, `browser.storage` in an
extension).

**Recommended retention window: 30 days of inactivity**, which is the SDK default
(`DEFAULT_SESSION_MAX_AGE_MS`).

Cached session state is **not a credential**: it holds no key material and cannot
authorize anything on its own — every signature still requires a live WebAuthn
ceremony against the passkey. What it does carry is a durable link between a
browser profile and an on-chain account, which is why it should not sit in
`localStorage` indefinitely on a shared or long-lived device. 30 days keeps
"open the app, still signed in" true for ordinary use while bounding how long an
abandoned profile keeps pointing at an account.

The window is **enforced by the SDK on read**. `restore()` measures the cached
entry's age from its `lastActiveAt` and, if it is past the max age, discards it
and clears it from storage rather than resuming it — so expired state is evicted,
not merely ignored:

```ts
const store = createSessionStore(createWebStorageAdapter(window.localStorage), {
  maxAgeMs: 12 * 60 * 60 * 1000, // 12 hours; defaults to 30 days
});

await store.getState().restore();
store.getState().status; // "disconnected" if the cached state had aged out
```

Because age is measured from `lastActiveAt` — which `touch()` refreshes on user
activity — the window is an **idle** timeout, not a hard cap on session lifetime.

- **Choose a shorter window for a stricter posture.** Shared kiosks and custodial
  dashboards should shorten it; a few hours is reasonable.
- **`maxAgeMs: Infinity`** opts out of expiry, for an ephemeral storage adapter.
- **A non-positive or `NaN` `maxAgeMs` throws a `RangeError`** at construction.
- **Unparseable `lastActiveAt` is treated as expired**; a future one (clock skew)
  is never expired.
- **`isSessionExpired(session, maxAgeMs?, now?)`** applies the same rule directly.

`end()` still clears storage on sign-out. Retention is the backstop for sessions
that are never returned to.
