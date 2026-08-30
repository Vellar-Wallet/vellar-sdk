// Example: model the session store's refresh() return shape.
//
// The SDK's session store (`createSessionStore`, src/session.ts) exposes a
// `refresh()` method that re-reads the persisted session from storage and
// resolves to a documented `SessionRefreshResult` — `{ session, status }`.
// This example re-creates that exact shape in a self-contained, runnable way
// (this folder cannot import from src/ by contributor policy) so consumers can
// see what refresh() returns and how to switch on the outcome.
//
// Run with: npx tsx contrib/examples/session-refresh/session-refresh.ts

/** The current session status if the SDK's session store were fully modeled. */
export type SessionStatus = "loading" | "connected" | "disconnected";

/**
 * The documented return shape of the session store's refresh() method.
 *
 * refresh() resolves to the post-refresh session and status so consumers can
 * switch on the outcome instead of guessing:
 *
 * - `{ session, status: "connected" }` — a valid session was loaded from
 *   storage;
 * - `{ session: null, status: "disconnected" }` — nothing usable was
 *   persisted (empty, malformed, or unreadable storage).
 *
 * refresh() never rejects; unreadable storage resolves to disconnected.
 */
export interface SessionRefreshResult {
  session: WalletSession | null;
  status: SessionStatus;
}

/** A minimal wallet session (SDK's WalletSession subset). */
export interface WalletSession {
  /** The Soroban contract address of the wallet (starts with "C"). */
  accountId: string;
  /** Optional passkey credential id enabling reconnect without a prompt. */
  keyId?: string;
  /** ISO 8601 timestamp of the last user activity. */
  lastActiveAt: string;
}

/**
 * A minimal in-memory "storage" mirroring SessionStorageAdapter. Returns the
 * value passed to seed; an unreadable storage can be simulated with a loader
 * that throws.
 */
export interface SessionStorage {
  load(): Promise<WalletSession | null>;
  save(session: WalletSession): Promise<void>;
  clear(): Promise<void>;
}

/** A faithful, minimal re-creation of the SDK store's refresh() semantics. */
export function createSessionStore(storage: SessionStorage) {
  /** Load, validate, and settle state — mirrors src/session.ts refresh(). */
  async function loadFromStorage(): Promise<SessionRefreshResult> {
    try {
      const stored = await storage.load();
      if (stored && typeof stored.accountId === "string" && stored.accountId.length > 0) {
        return { session: stored, status: "connected" };
      }
      return { session: null, status: "disconnected" };
    } catch {
      // Unreadable storage must not brick the app on startup/refresh.
      return { session: null, status: "disconnected" };
    }
  }

  return {
    /**
     * Re-read the persisted session from storage and reflect it in store state.
     *
     * Use this to refresh the session after the app regains focus, after another
     * tab updated it, or whenever the stored session may have changed since
     * start/restore.
     *
     * @returns the post-refresh `SessionRefreshResult` (`{ session, status }`).
     */
    refresh(): Promise<SessionRefreshResult> {
      return loadFromStorage();
    },
  };
}

/** An in-memory implementation of SessionStorage for demonstration. */
export function createMemoryStorage(seed: WalletSession | null): SessionStorage {
  let stored = seed;
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

async function main() {
  console.log("=== Session Store refresh() Return Shape ===\n");

  const session: WalletSession = {
    accountId: "CA7QY3Z54G5P6H7J8K9L0M1N2O3P4Q5R6S7T8U9V0W1X2Y3Z4A5B6C7D",
    lastActiveAt: new Date().toISOString(),
  };

  // Case 1: a valid session is persisted -> connected shape.
  const connected = createSessionStore(createMemoryStorage(session));
  const connectedResult = await connected.refresh();
  console.log("Persisted session:", JSON.stringify(connectedResult, null, 2));

  console.log("\n-----------------------------------\n");

  // Case 2: nothing persisted -> disconnected shape.
  const empty = createSessionStore(createMemoryStorage(null));
  const emptyResult = await empty.refresh();
  console.log("Empty storage:", JSON.stringify(emptyResult, null, 2));

  console.log("\n-----------------------------------\n");

  // Case 3: unreadable storage -> disconnected, never rejects.
  const broken = createSessionStore({
    load: async () => {
      throw new Error("quota exceeded");
    },
    save: async () => {},
    clear: async () => {},
  });
  const brokenResult = await broken.refresh();
  console.log("Unreadable storage:", JSON.stringify(brokenResult, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}