import { createStore, type StoreApi } from "zustand/vanilla";
import type { Network, WalletSession } from "./types";

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

export type DisconnectReason = "explicit" | "corrupt_storage" | "network_mismatch";

export interface SessionState {
  session: WalletSession | null;
  status: SessionStatus;
  /** Observable reason when status is "disconnected", distinguishing empty from rejected sessions (#409). */
  disconnectReason?: DisconnectReason | null;
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
   * Expected network for this client instance ("testnet" | "mainnet").
   * When configured, `restore()` rejects any stored session whose network does
   * not match, clearing storage and leaving status as disconnected (#409).
   */
  network?: Network;
  /** Alias for `network`. */
  expectedNetwork?: Network;
  /**
   * Callback invoked when a stored session is discarded due to a network mismatch (#409).
   * Allows the UI to differentiate an empty session from a rejected session.
   */
  onSessionMismatch?: (rejectedSession: WalletSession, expectedNetwork: Network) => void;
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
  options: CreateSessionStoreOptions = {},
): SessionStore {
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
    disconnectReason: null,

    async start(session) {
      await storage.save(session);
      set({ session, status: "connected", disconnectReason: null });
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
      set({ session: null, status: "disconnected", disconnectReason: "explicit" });
    },

    async restore() {
      try {
        const stored = await storage.load();
        if (stored && isWalletSession(stored)) {
          const expected = options.expectedNetwork ?? options.network;
          if (expected && stored.network !== expected) {
            // Session network mismatch (#409): discard the stale session,
            // clear storage, and remain disconnected without throwing.
            await storage.clear();
            stopRefresh();
            set({ session: null, status: "disconnected", disconnectReason: "network_mismatch" });
            options.onSessionMismatch?.(stored, expected);
            return;
          }
          set({ session: stored, status: "connected", disconnectReason: null });
          startRefresh();
        } else {
          set({ session: null, status: "disconnected", disconnectReason: null });
        }
      } catch {
        // Unreadable storage must not brick the app on startup.
        set({ session: null, status: "disconnected", disconnectReason: "corrupt_storage" });
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
