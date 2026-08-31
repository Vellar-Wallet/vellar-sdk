import { createStore, type StoreApi } from "zustand/vanilla";
import type { WalletSession } from "./types";

// Session persistence seam (idea.md §6.1 WalletSessionStore). The store is a
// vanilla zustand store so the web app (React) and the extension (background
// worker + popup) can share it; each surface supplies its own storage adapter
// (localStorage vs browser.storage), keeping the logic itself DRY.

export interface SessionStorageAdapter {
  load(): Promise<WalletSession | null>;
  save(session: WalletSession): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Recommended retention window for cached session state: **30 days** of
 * inactivity.
 *
 * Cached session state is low-sensitivity (a public smart-account address, a
 * public passkey credential id, timestamps) — it is *not* a credential, and it
 * cannot authorize anything on its own; every signature still needs a live
 * WebAuthn ceremony. What it does carry is a durable link between a browser
 * profile and an on-chain account, so it should not sit in `localStorage`
 * forever on a shared or long-lived device.
 *
 * 30 days keeps "open the app, still signed in" true for ordinary use while
 * bounding how long an abandoned profile keeps pointing at an account. Consumers
 * with a stricter posture (shared kiosks, custodial dashboards) should shorten
 * it — a few hours is reasonable — via `createSessionStore(storage, { maxAgeMs })`.
 */
export const DEFAULT_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionStatus = "loading" | "connected" | "disconnected";

export interface SessionState {
  session: WalletSession | null;
  status: SessionStatus;
  /** Begin a session (after wallet create/connect) and persist it. */
  start(session: WalletSession): Promise<void>;
  /** Update lastActiveAt on user activity and persist. No-op when disconnected. */
  touch(now?: Date): Promise<void>;
  /** End the session and clear persisted state. */
  end(): Promise<void>;
  /** Restore a persisted session on startup. Corrupt/unreadable storage means disconnected, never a crash. */
  restore(): Promise<void>;
  /**
   * Graceful teardown for long-lived consumers (React unmount, extension
   * shutdown): clears any internal timers (e.g. the optional refresh polling)
   * and releases listers so no dangling references keep the session alive.
   * Safe to call multiple times and after disconnection. Does not mutate the
   * session or storage — pairing with `end()` first is up to the caller.
   */
  dispose(): void;
}

export type SessionStore = StoreApi<SessionState>;

export interface CreateSessionStoreOptions {
  /**
   * Optional background "refresh polling": while connected, `touch()` is called
   * every `refreshIntervalMs` to keep `lastActiveAt` fresh. Omit (the default)
   * to disable periodic polling. Any in-progress polling is stopped by
   * `dispose()`.
   */
  refreshIntervalMs?: number;
  /**
   * Maximum age of cached session state, in milliseconds, measured from its
   * `lastActiveAt`. Enforced on read: `restore()` discards (and clears from
   * storage) anything older than this instead of resuming it.
   *
   * Defaults to {@link DEFAULT_SESSION_MAX_AGE_MS} (30 days). Pass `Infinity`
   * to opt out of expiry entirely — only appropriate when the storage adapter
   * itself is ephemeral. Must be a positive number; anything else throws.
   */
  maxAgeMs?: number;
}

export function isWalletSession(value: unknown): value is WalletSession {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.accountId === "string" &&
    v.accountId.length > 0 &&
    (v.network === "testnet" || v.network === "mainnet") &&
    typeof v.connected === "boolean" &&
    v.authMethod === "passkey" &&
    typeof v.createdAt === "string" &&
    typeof v.lastActiveAt === "string"
  );
}

/**
 * Has cached session state outlived its retention window?
 *
 * Age is measured from `lastActiveAt` (refreshed by `touch()`), so the window is
 * an *idle* timeout, not a hard cap on session lifetime. Session state whose
 * `lastActiveAt` is unparseable is treated as expired: an unreadable timestamp
 * means the age cannot be bounded, and cached state we cannot age out is exactly
 * what the retention window exists to prevent.
 *
 * A `lastActiveAt` in the future (clock skew, or a doctored storage entry) is
 * never expired — its age is clamped at zero rather than going negative.
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

export function createSessionStore(
  storage: SessionStorageAdapter,
  options: CreateSessionStoreOptions = {},
): SessionStore {
  // Validate the retention window up front so a misconfigured maxAgeMs fails at
  // wiring time rather than silently on the first restore().
  const maxAgeMs = resolveMaxAgeMs(options.maxAgeMs);

  // Long-lived resources owned by the store: the optional refresh-polling
  // interval plus a disposed latch so a torn-down store never schedules new
  // work. `dispose()` clears both; nothing in the store keeps a reference to
  // them afterwards.
  let timer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;

  function startRefresh(): void {
    if (disposed) return;
    if (timer !== null) return;
    if (!options.refreshIntervalMs || options.refreshIntervalMs <= 0) return;
    timer = setInterval(() => {
      // Refresh is a fire-and-forget touch; storage failures are non-fatal here
      // (the user-facing start()/touch() still surface them).
      if (disposed) return;
      void store.getState().touch();
    }, options.refreshIntervalMs);
  }

  function stopRefresh(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  let store: SessionStore = null as never;

  store = createStore<SessionState>((set, get) => ({
    session: null,
    status: "loading",

    async start(session) {
      await storage.save(session);
      set({ session, status: "connected" });
      // Begin periodic refresh only once connected (and only if configured).
      startRefresh();
    },

    async touch(now = new Date()) {
      const { session } = get();
      if (!session) return;
      const updated: WalletSession = { ...session, lastActiveAt: now.toISOString() };
      await storage.save(updated);
      set({ session: updated });
    },

    async end() {
      await storage.clear();
      // Disconnect stops any in-flight refresh polling.
      stopRefresh();
      set({ session: null, status: "disconnected" });
    },

    async restore() {
      try {
        const stored = await storage.load();
        if (!stored || !isWalletSession(stored)) {
          set({ session: null, status: "disconnected" });
          return;
        }
        if (isSessionExpired(stored, maxAgeMs)) {
          // Past the retention window: discard it rather than resume it, and
          // evict it from storage so an abandoned profile stops carrying the
          // account link around. A clear failure here is not fatal — the
          // in-memory decision (disconnected) still holds.
          try {
            await storage.clear();
          } catch {
            // Best-effort eviction; read-only or full storage must not brick startup.
          }
          set({ session: null, status: "disconnected" });
          return;
        }
        set({ session: stored, status: "connected" });
        startRefresh();
      } catch {
        // Unreadable storage must not brick the app on startup.
        set({ session: null, status: "disconnected" });
      }
    },

    dispose() {
      disposed = true;
      stopRefresh();
    },
  }));

  return store;
}

/** Storage-backed adapter for web (pass window.localStorage) or any Storage-like object. */
export function createWebStorageAdapter(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  key = "vellar.session",
): SessionStorageAdapter {
  return {
    async load() {
      const raw = storage.getItem(key);
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      return isWalletSession(parsed) ? parsed : null;
    },
    async save(session) {
      storage.setItem(key, JSON.stringify(session));
    },
    async clear() {
      storage.removeItem(key);
    },
  };
}

/** In-memory adapter for tests and ephemeral contexts. */
export function createMemoryStorageAdapter(): SessionStorageAdapter {
  let stored: WalletSession | null = null;
  return {
    async load() {
      return stored;
    },
    async save(session) {
      stored = session;
    },
    async clear() {
      stored = null;
    },
  };
}
