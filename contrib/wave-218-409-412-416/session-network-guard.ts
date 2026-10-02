import { createStore, type StoreApi } from "zustand/vanilla";
import {
  isWalletSession,
  type CreateSessionStoreOptions,
  type SessionStorageAdapter,
  type SessionStatus,
} from "../../src/session";
import type { Network, WalletSession } from "../../src/types";

export type DisconnectReason = "manual" | "network_mismatch";

export interface SessionMismatchEvent {
  session: WalletSession;
  expectedNetwork: Network;
}

export interface SessionNetworkGuardOptions extends CreateSessionStoreOptions {
  /** Expected Stellar network (e.g. 'testnet' | 'mainnet'). If restored session diverges, it is discarded (#409). */
  expectedNetwork?: Network;
  /** Callback fired when a stored session is discarded due to a network mismatch (#409). */
  onSessionMismatch?: (event: SessionMismatchEvent) => void;
}

export interface GuardedSessionState {
  session: WalletSession | null;
  status: SessionStatus;
  disconnectReason?: DisconnectReason | null;
  start(session: WalletSession): Promise<void>;
  touch(now?: Date): Promise<void>;
  end(): Promise<void>;
  restore(): Promise<void>;
  dispose(): void;
}

export type GuardedSessionStore = StoreApi<GuardedSessionState>;

/**
 * Creates a session store that guards against restoring sessions on the wrong network (#409).
 * If the restored session's network diverges from expectedNetwork:
 * - The session is rejected and discarded
 * - Storage is cleared
 * - Status transitions to 'disconnected' with disconnectReason: 'network_mismatch'
 * - onSessionMismatch callback is triggered for observability
 */
export function createSessionStoreWithNetworkGuard(
  storage: SessionStorageAdapter,
  options: SessionNetworkGuardOptions = {},
): GuardedSessionStore {
  let timer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;

  function startRefresh(): void {
    if (disposed) return;
    if (timer !== null) return;
    if (!options.refreshIntervalMs || options.refreshIntervalMs <= 0) return;
    timer = setInterval(() => {
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

  let store: GuardedSessionStore = null as never;

  store = createStore<GuardedSessionState>((set, get) => ({
    session: null,
    status: "loading",
    disconnectReason: null,

    async start(session) {
      await storage.save(session);
      set({ session, status: "connected", disconnectReason: null });
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
      stopRefresh();
      set({ session: null, status: "disconnected", disconnectReason: "manual" });
    },

    async restore() {
      try {
        const stored = await storage.load();
        if (stored && isWalletSession(stored)) {
          if (options.expectedNetwork && stored.network !== options.expectedNetwork) {
            await storage.clear();
            stopRefresh();
            set({ session: null, status: "disconnected", disconnectReason: "network_mismatch" });
            options.onSessionMismatch?.({
              session: stored,
              expectedNetwork: options.expectedNetwork,
            });
            return;
          }

          set({ session: stored, status: "connected", disconnectReason: null });
          startRefresh();
        } else {
          set({ session: null, status: "disconnected", disconnectReason: null });
        }
      } catch {
        set({ session: null, status: "disconnected", disconnectReason: null });
      }
    },

    dispose() {
      disposed = true;
      stopRefresh();
    },
  }));

  return store;
}
