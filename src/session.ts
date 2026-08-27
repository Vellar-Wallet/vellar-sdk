import { createStore, type StoreApi } from "zustand/vanilla";
import type { WalletSession } from "./types";

// Session persistence seam (idea.md §6.1 WalletSessionStore). The store is a
// vanilla zustand store so the web app (React) and the extension (background
// worker + popup) can share it; each surface supplies its own storage adapter
// (localStorage vs browser.storage), keeping the logic itself DRY.

/**
 * Persisted session envelope version. Bump when WalletSession fields or semantics
 * change; reads with a different version are rejected (safe fallback to
 * disconnected) rather than silently misinterpreted.
 */
export const SESSION_SCHEMA_VERSION = 1;

interface PersistedSessionEnvelope {
  schemaVersion: number;
  session: WalletSession;
}

function isPersistedSessionEnvelope(value: unknown): value is PersistedSessionEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === SESSION_SCHEMA_VERSION &&
    isWalletSession(v.session)
  );
}

function wrapSession(session: WalletSession): PersistedSessionEnvelope {
  return { schemaVersion: SESSION_SCHEMA_VERSION, session };
}

function unwrapSession(value: unknown): WalletSession | null {
  // Versioned envelope written by current SDK.
  if (isPersistedSessionEnvelope(value)) {
    return value.session;
  }
  // Legacy unversioned writes are rejected — format may predate a breaking change.
  if (isWalletSession(value)) {
    return null;
  }
  return null;
}

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
      return unwrapSession(parsed);
    },
    async save(session) {
      storage.setItem(key, JSON.stringify(wrapSession(session)));
    },
    async clear() {
      storage.removeItem(key);
    },
  };
}

/** In-memory adapter for tests and ephemeral contexts. */
export function createMemoryStorageAdapter(): SessionStorageAdapter {
  let stored: PersistedSessionEnvelope | null = null;
  return {
    async load() {
      return stored ? unwrapSession(stored) : null;
    },
    async save(session) {
      stored = wrapSession(session);
    },
    async clear() {
      stored = null;
    },
  };
}
