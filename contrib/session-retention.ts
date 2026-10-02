/**
 * Data retention for cached session state (#292).
 *
 * `createSessionStore` (src/session.ts) persists session state through a
 * `SessionStorageAdapter` — `localStorage` on the web, `browser.storage` in an
 * extension — with no bound on how long that state may live. This module adds a
 * retention window without modifying the core store: it wraps a
 * `SessionStorageAdapter` so the max age is enforced **on read**.
 *
 * ## What this data is (and why the window is what it is)
 *
 * Cached session state holds **no key material** and cannot authorize anything
 * on its own: every signature still requires a live WebAuthn ceremony against
 * the passkey. It is the public smart-account address, the public passkey
 * credential id, and two timestamps. What it *does* carry is a durable link
 * between a browser profile and an on-chain account, which is why it should not
 * sit in `localStorage` indefinitely on a shared or long-lived device.
 *
 * That balance is what {@link DEFAULT_SESSION_MAX_AGE_MS} encodes: 30 days keeps
 * "open the app, still signed in" true for ordinary use while bounding how long
 * an abandoned profile keeps pointing at an account.
 *
 * ## Why the seam is the adapter, not the store
 *
 * Wrapping the adapter rather than the store means the window applies to *every*
 * read path — `restore()` today, plus anything that later loads through the same
 * adapter — and composes with any adapter (web storage, extension storage, a
 * custom one) without the core store knowing retention exists.
 */

import type { SessionStorageAdapter, WalletSession } from "../src/index.js";

/**
 * Recommended retention window for cached session state: **30 days** of
 * inactivity.
 *
 * Consumers with a stricter posture (shared kiosks, custodial dashboards)
 * should shorten it — a few hours is reasonable — via `maxAgeMs`.
 */
export const DEFAULT_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionRetentionOptions {
  /**
   * Maximum age of cached session state, in milliseconds, measured from its
   * `lastActiveAt`. Enforced on read: a load past this age yields `null` and the
   * entry is cleared from storage instead of being returned.
   *
   * Defaults to {@link DEFAULT_SESSION_MAX_AGE_MS} (30 days). Pass `Infinity` to
   * opt out of expiry entirely — only appropriate when the underlying adapter is
   * itself ephemeral. Must be a positive number; anything else throws.
   */
  maxAgeMs?: number;
  /** Clock seam, for tests. Defaults to `() => new Date()`. */
  now?: () => Date;
}

/**
 * Has cached session state outlived its retention window?
 *
 * Age is measured from `lastActiveAt` (refreshed by the store's `touch()`), so
 * the window is an *idle* timeout, not a hard cap on session lifetime: an
 * actively used session keeps renewing, while an untouched one ages out.
 *
 * Session state whose `lastActiveAt` is unparseable is treated as expired — an
 * age that cannot be bounded is exactly what the retention window exists to
 * prevent. A `lastActiveAt` in the future (clock skew, or a doctored storage
 * entry) is never expired; its age is clamped at zero rather than going
 * negative.
 */
export function isSessionExpired(
  session: WalletSession,
  maxAgeMs: number = DEFAULT_SESSION_MAX_AGE_MS,
  now: Date = new Date(),
): boolean {
  if (maxAgeMs === Infinity) return false;
  const lastActive = Date.parse(session.lastActiveAt);
  if (Number.isNaN(lastActive)) return true;
  const ageMs = Math.max(0, now.getTime() - lastActive);
  return ageMs > maxAgeMs;
}

function resolveMaxAgeMs(maxAgeMs: number | undefined): number {
  if (maxAgeMs === undefined) return DEFAULT_SESSION_MAX_AGE_MS;
  if (typeof maxAgeMs !== "number" || Number.isNaN(maxAgeMs) || maxAgeMs <= 0) {
    throw new RangeError(
      `maxAgeMs must be a positive number of milliseconds (or Infinity to disable expiry), got ${String(maxAgeMs)}`,
    );
  }
  return maxAgeMs;
}

/**
 * Wrap a `SessionStorageAdapter` so cached session state past `maxAgeMs` is
 * discarded on read.
 *
 * Expired state is **evicted**, not merely ignored: the wrapper clears it from
 * the underlying storage as well as returning `null`. Ignoring it would leave
 * the very entry the window exists to bound sitting in `localStorage` forever.
 *
 * Eviction is best-effort. If the underlying `clear()` throws (read-only or full
 * storage), the read still resolves to `null` — the retention decision holds
 * even when the cleanup cannot, so a failing storage backend never resurrects an
 * expired session or bricks startup.
 *
 * A misconfigured `maxAgeMs` throws a `RangeError` here, at wiring time, rather
 * than silently disabling expiry on the first load.
 *
 * ```ts
 * const store = createSessionStore(
 *   withSessionRetention(createWebStorageAdapter(window.localStorage), {
 *     maxAgeMs: 12 * 60 * 60 * 1000, // 12 hours
 *   }),
 * );
 * await store.getState().restore(); // "disconnected" if the entry had aged out
 * ```
 */
export function withSessionRetention(
  adapter: SessionStorageAdapter,
  options: SessionRetentionOptions = {},
): SessionStorageAdapter {
  const maxAgeMs = resolveMaxAgeMs(options.maxAgeMs);
  const now = options.now ?? (() => new Date());

  return {
    async load() {
      const stored = await adapter.load();
      if (stored === null) return null;
      if (!isSessionExpired(stored, maxAgeMs, now())) return stored;

      // Past the window: evict so an abandoned profile stops carrying the
      // account link around. A failed eviction must not resurrect the session.
      try {
        await adapter.clear();
      } catch {
        // Best-effort: the null result below is the decision that matters.
      }
      return null;
    },
    save(session) {
      return adapter.save(session);
    },
    clear() {
      return adapter.clear();
    },
  };
}
