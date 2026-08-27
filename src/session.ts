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

/**
 * Return shape of {@link SessionState.refresh}.
 *
 * The refresh method resolves to the post-refresh session and status so
 * consumers can switch on the outcome instead of guessing:
 *
 * - `{ session, status: "connected" }` — a valid session was loaded from
 *   storage;
 * - `{ session: null, status: "disconnected" }` — nothing usable was
 *   persisted (empty, malformed, or unreadable storage).
 */
export interface SessionRefreshResult {
  session: WalletSession | null;
  status: SessionStatus;
}

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
   * Re-read the persisted session from storage and reflect it in store state.
   *
   * Use this to refresh the session after the app regains focus, after another
   * tab updated it, or whenever the stored session may have changed since
   * `start`/`restore`. Corrupt or unreadable storage resolves to
   * `{ session: null, status: "disconnected" }`, never a rejected promise.
   *
   * @returns the post-refresh session and status (see {@link SessionRefreshResult}).
   */
  refresh(): Promise<SessionRefreshResult>;
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
  return createStore<SessionState>((set, get) => {
    /** Shared by restore() and refresh(): load, validate, and settle state. */
    async function loadFromStorage(): Promise<SessionRefreshResult> {
      try {
        const stored = await storage.load();
        if (stored && isWalletSession(stored)) {
          set({ session: stored, status: "connected" });
          return { session: stored, status: "connected" };
        }
        set({ session: null, status: "disconnected" });
        return { session: null, status: "disconnected" };
      } catch {
        // Unreadable storage must not brick the app on startup.
        set({ session: null, status: "disconnected" });
        return { session: null, status: "disconnected" };
      }
    }

    return {
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
        await loadFromStorage();
      },

      async refresh() {
        return loadFromStorage();
      },
    };
  });
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
