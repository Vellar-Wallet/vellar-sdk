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
  /**
   * Restore a persisted session on startup. Corrupt/unreadable storage means
   * disconnected, never a crash. A session idle past `idleTimeoutMs` (if
   * configured) is expired and cleared instead of restored — see
   * `createSessionStore`'s `idleTimeoutMs` option.
   */
  restore(): Promise<void>;
}

export type SessionStore = StoreApi<SessionState>;

export interface SessionStoreOptions {
  /**
   * How long a session may go without activity (`lastActiveAt`) before it's
   * treated as expired. Checked on `restore()` — the natural point where a
   * session that's been sitting untouched (tab closed, browser reopened
   * days later, a background worker waking up) gets read back in. Not
   * enforced by `touch()` itself, since touching is what proves the session
   * is still active. Unset (the default) disables idle expiry entirely,
   * preserving prior behavior for existing callers.
   */
  idleTimeoutMs?: number;
  /**
   * Called when `restore()` expires an idle session, before it's cleared.
   * Defaults to a no-op; pass your own logger to observe idle expirations
   * (e.g. for debugging unexpectedly-short sessions in the field).
   */
  onIdleExpired?: (info: { session: WalletSession; idleForMs: number }) => void;
  /** Injectable clock, primarily for tests. Defaults to `() => new Date()`. */
  now?: () => Date;
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

export function createSessionStore(
  storage: SessionStorageAdapter,
  options: SessionStoreOptions = {},
): SessionStore {
  const { idleTimeoutMs, onIdleExpired = () => {}, now: clock = () => new Date() } = options;

  return createStore<SessionState>((set, get) => ({
    session: null,
    status: "loading",

    async start(session) {
      await storage.save(session);
      set({ session, status: "connected" });
    },

    async touch(now = clock()) {
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
          if (idleTimeoutMs !== undefined) {
            const idleForMs = clock().getTime() - Date.parse(stored.lastActiveAt);
            // A negative idleForMs (lastActiveAt in the future — clock skew,
            // a bogus persisted value) is never treated as expired; only a
            // genuinely elapsed idle period is.
            if (idleForMs > idleTimeoutMs) {
              onIdleExpired({ session: stored, idleForMs });
              await storage.clear();
              set({ session: null, status: "disconnected" });
              return;
            }
          }
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
