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
}

export type SessionStore = StoreApi<SessionState>;

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

export function createSessionStore(storage: SessionStorageAdapter): SessionStore {
  return createStore<SessionState>((set, get) => ({
    session: null,
    status: "loading",

    async start(session) {
      await storage.save(session);
      set({ session, status: "connected" });
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
      set({ session: null, status: "disconnected" });
    },

    async restore() {
      try {
        const stored = await storage.load();
        if (stored && isWalletSession(stored)) {
          set({ session: stored, status: "connected" });
        } else {
          set({ session: null, status: "disconnected" });
        }
      } catch {
        // Unreadable storage must not brick the app on startup.
        set({ session: null, status: "disconnected" });
      }
    },
  }));
}

/**
 * Default retention window for a session cached in consumer local storage:
 * 30 days of inactivity. `lastActiveAt` is refreshed on every `touch()`
 * (idea.md §6.1), so a session in regular use never ages out — this only
 * discards a session nobody has used in a long time, on the theory that
 * `restore()` re-authenticating via a fresh passkey ceremony is safer at that
 * point than trusting month-old cached wallet state. See the README's
 * "Session cache retention" section for the full rationale.
 */
export const DEFAULT_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface WebStorageAdapterOptions {
  /**
   * Discard (and report as absent) a persisted session whose `lastActiveAt`
   * is older than this, in milliseconds. Enforced on read (`load()`), not on
   * a timer — nothing runs while the app isn't open. Defaults to
   * {@link DEFAULT_SESSION_MAX_AGE_MS}; pass `Infinity` to disable expiry
   * entirely (the pre-#292 behaviour).
   */
  maxAgeMs?: number;
  /** Clock for the age check (defaults to `() => Date.now()`); overridable for tests. */
  now?: () => number;
}

/** Storage-backed adapter for web (pass window.localStorage) or any Storage-like object. */
export function createWebStorageAdapter(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  key = "vellar.session",
  options: WebStorageAdapterOptions = {},
): SessionStorageAdapter {
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_SESSION_MAX_AGE_MS;
  const now = options.now ?? (() => Date.now());
  return {
    async load() {
      const raw = storage.getItem(key);
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!isWalletSession(parsed)) return null;
      const lastActive = Date.parse(parsed.lastActiveAt);
      if (Number.isFinite(lastActive) && now() - lastActive > maxAgeMs) {
        // Past the retention window: treat it as absent rather than restoring
        // stale wallet state, and drop it so a later load() doesn't re-check
        // the same expired entry.
        storage.removeItem(key);
        return null;
      }
      return parsed;
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
