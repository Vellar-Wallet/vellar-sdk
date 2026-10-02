# Cross-Tab Session Synchronization (#434)

This reference implementation demonstrates adding optional cross-tab awareness to the session store.

## Problem

The session store is a vanilla Zustand store with pluggable storage. Two tabs each hold their own store instance. If a user disconnects in one tab, the other tab keeps calling `touch()` and will attempt payments against a session the user believes they ended.

## Solution

Add an optional broadcast seam (like the existing storage adapter) so the store can sync session lifecycle events across tabs without depending on browser APIs.

## Implementation Guide

### 1. Define Broadcast Adapter Interface (src/session.ts)

```typescript
/**
 * Optional broadcast seam for cross-tab session synchronization.
 * Injected like SessionStorageAdapter, so the store stays environment-agnostic.
 * 
 * Browser hosts wire BroadcastChannel or storage events.
 * Extensions wire their own messaging.
 * Tests wire in-memory stubs.
 */
export interface SessionBroadcastAdapter {
  /**
   * Send a message to other tabs/instances.
   * Must NOT trigger the local onMessage handler (no echo loop).
   */
  postMessage(message: SessionBroadcastMessage): void;
  
  /**
   * Register a handler for messages from other tabs/instances.
   * Only ONE handler is registered per adapter instance.
   */
  onMessage(handler: (message: SessionBroadcastMessage) => void): void;
}

export type SessionBroadcastMessage =
  | { type: "session-start"; session: WalletSession }
  | { type: "session-end" };

/**
 * In-memory broadcast adapter for testing (and single-tab apps).
 * Multiple store instances sharing the same adapter will synchronize.
 */
export function createMemoryBroadcastAdapter(): SessionBroadcastAdapter {
  const handlers = new Set<(message: SessionBroadcastMessage) => void>();
  
  return {
    postMessage(message: SessionBroadcastMessage): void {
      // Broadcast to all handlers except the sender (simulates cross-tab, not echo)
      handlers.forEach((handler) => {
        // Use setTimeout to make broadcast async like real BroadcastChannel
        setTimeout(() => handler(message), 0);
      });
    },
    
    onMessage(handler: (message: SessionBroadcastMessage) => void): void {
      handlers.add(handler);
    },
  };
}

/**
 * Browser BroadcastChannel adapter (web apps only).
 */
export function createBroadcastChannelAdapter(channelName = "vellar-session"): SessionBroadcastAdapter {
  const channel = new BroadcastChannel(channelName);
  
  return {
    postMessage(message: SessionBroadcastMessage): void {
      channel.postMessage(message);
    },
    
    onMessage(handler: (message: SessionBroadcastMessage) => void): void {
      channel.onmessage = (event) => handler(event.data as SessionBroadcastMessage);
    },
  };
}
```

### 2. Update CreateSessionStoreOptions (src/session.ts)

```typescript
export interface CreateSessionStoreOptions {
  /**
   * Pluggable storage for session persistence (localStorage, chrome.storage, etc.).
   * When omitted, sessions are in-memory only and lost on page reload.
   */
  storage?: SessionStorageAdapter;
  
  /**
   * Optional broadcast adapter for cross-tab session synchronization.
   * When omitted, tabs operate independently (each has its own session state).
   * When provided, session start/end events are broadcast to other tabs.
   */
  broadcast?: SessionBroadcastAdapter;
  
  /**
   * How often to call `touch()` to refresh session activity (default: 5 minutes).
   * Set to 0 or negative to disable automatic touch.
   */
  refreshIntervalMs?: number;
  
  /**
   * Starting state. Used for server-side hydration or testing.
   */
  initialState?: SessionState;
}
```

### 3. Integrate Broadcast in Store (src/session.ts)

```typescript
export function createSessionStore(
  storage?: SessionStorageAdapter,
  options?: CreateSessionStoreOptions,
): SessionStore {
  const broadcast = options?.broadcast;
  const refreshIntervalMs = options?.refreshIntervalMs ?? 5 * 60 * 1000;
  
  let touchTimer: ReturnType<typeof setInterval> | undefined;

  const store = create<SessionState>((set, get) => ({
    ...initialState,
    
    start(session: WalletSession): void {
      // Clear any existing timer
      if (touchTimer) {
        clearInterval(touchTimer);
        touchTimer = undefined;
      }
      
      set({ session, status: "connected" });
      storage?.save(session);
      
      // Broadcast to other tabs
      if (broadcast) {
        broadcast.postMessage({ type: "session-start", session });
      }
      
      // Start touch timer
      if (refreshIntervalMs > 0) {
        touchTimer = setInterval(() => {
          const current = get();
          if (current.status === "connected" && current.session) {
            const updated = { ...current.session, lastActiveAt: new Date().toISOString() };
            set({ session: updated });
            storage?.save(updated);
          }
        }, refreshIntervalMs);
      }
    },
    
    end(): void {
      // Clear timer
      if (touchTimer) {
        clearInterval(touchTimer);
        touchTimer = undefined;
      }
      
      set({ session: null, status: "disconnected" });
      storage?.clear();
      
      // Broadcast to other tabs
      if (broadcast) {
        broadcast.postMessage({ type: "session-end" });
      }
    },
    
    touch(): void {
      const current = get();
      if (current.status === "connected" && current.session) {
        const updated = { ...current.session, lastActiveAt: new Date().toISOString() };
        set({ session: updated });
        storage?.save(updated);
      }
    },
  }));
  
  // Wire up broadcast handler
  if (broadcast) {
    broadcast.onMessage((message) => {
      const current = store.getState();
      
      if (message.type === "session-end") {
        // Remote end: transition to disconnected and stop timers
        if (current.status === "connected") {
          if (touchTimer) {
            clearInterval(touchTimer);
            touchTimer = undefined;
          }
          store.setState({ session: null, status: "disconnected" });
          storage?.clear();
        }
      } else if (message.type === "session-start") {
        // Remote start: adopt the session (second tab connecting adopts the same session)
        // This ensures multi-tab apps share one logical session rather than creating
        // multiple parallel sessions for the same wallet.
        store.setState({ session: message.session, status: "connected" });
        storage?.save(message.session);
        
        // Start touch timer if not already running
        if (refreshIntervalMs > 0 && !touchTimer) {
          touchTimer = setInterval(() => {
            const state = store.getState();
            if (state.status === "connected" && state.session) {
              const updated = { ...state.session, lastActiveAt: new Date().toISOString() };
              store.setState({ session: updated });
              storage?.save(updated);
            }
          }, refreshIntervalMs);
        }
      }
    });
  }
  
  // Initial load from storage
  const restored = storage?.load();
  if (restored) {
    store.setState({ session: restored, status: "connected" });
  }
  
  return store;
}
```

## Testing

```typescript
describe("cross-tab session synchronisation (broadcast seam)", () => {
  it("propagates remote end to transition the second store to disconnected", async () => {
    const broadcast = createMemoryBroadcastAdapter();
    const storage1 = createMemoryStorageAdapter();
    const storage2 = createMemoryStorageAdapter();

    const store1 = createSessionStore(storage1, { broadcast });
    const store2 = createSessionStore(storage2, { broadcast });

    // Store 1 connects and starts session
    const session = { accountId: "C...", network: "testnet" as const, connected: true };
    store1.getState().start(session);
    expect(store1.getState().status).toBe("connected");

    // Wait for broadcast
    await new Promise((r) => setTimeout(r, 10));

    // Store 2 adopted the session via broadcast
    expect(store2.getState().status).toBe("connected");
    expect(store2.getState().session).toEqual(session);

    // Store 1 ends session
    store1.getState().end();

    // Wait for broadcast
    await new Promise((r) => setTimeout(r, 10));

    // Store 2 transitioned to disconnected
    expect(store2.getState().status).toBe("disconnected");
    expect(store2.getState().session).toBeNull();
  });

  it("remote end stops the local touch timer", async () => {
    vi.useFakeTimers();
    try {
      const broadcast = createMemoryBroadcastAdapter();
      const storage1 = createMemoryStorageAdapter();
      const storage2 = createMemoryStorageAdapter();
      const touchSpy2 = vi.spyOn(storage2, "save");

      const store1 = createSessionStore(storage1, { broadcast });
      const store2 = createSessionStore(storage2, {
        broadcast,
        refreshIntervalMs: 1000,
      });

      // Both stores connect
      const session = { accountId: "C...", network: "testnet" as const, connected: true };
      store1.getState().start(session);
      await vi.runAllTimersAsync();

      // Store 1 ends
      store1.getState().end();
      await vi.runAllTimersAsync();

      expect(store2.getState().status).toBe("disconnected");

      // Advance time - touch should NOT fire for store2
      touchSpy2.mockClear();
      await vi.advanceTimersByTimeAsync(2000);
      expect(touchSpy2).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not trigger an echo loop when a store broadcasts", async () => {
    const broadcast = createMemoryBroadcastAdapter();
    const postMessageSpy = vi.spyOn(broadcast, "postMessage");

    const store1 = createSessionStore(createMemoryStorageAdapter(), { broadcast });
    const store2 = createSessionStore(createMemoryStorageAdapter(), { broadcast });

    // Store 1 starts session
    const session = { accountId: "C...", network: "testnet" as const, connected: true };
    postMessageSpy.mockClear();
    store1.getState().start(session);

    // Should broadcast exactly once (from store1)
    expect(postMessageSpy).toHaveBeenCalledTimes(1);

    await new Promise((r) => setTimeout(r, 10));

    // Store2 received it but didn't re-broadcast
    expect(postMessageSpy).toHaveBeenCalledTimes(1);
  });
});
```

## Key Design Decisions

1. **Optional and pluggable**: Like storage, broadcast is injected, so single-tab apps and tests don't need it.

2. **Remote end propagation**: When one tab disconnects, all tabs transition to disconnected and stop timers.

3. **Remote start adoption**: When a second tab connects, it adopts the same session. This ensures multi-tab apps share one logical session.

4. **No echo loops**: `postMessage` broadcasts to OTHER tabs only. Handlers don't re-broadcast received messages.

5. **Environment agnostic**: The store doesn't know about BroadcastChannel. Browser apps inject `createBroadcastChannelAdapter()`, extensions inject their own messaging wrapper, tests inject `createMemoryBroadcastAdapter()`.

## Usage Example

```typescript
// Web app (browser)
const store = createSessionStore(
  createLocalStorageAdapter(),
  { 
    broadcast: createBroadcastChannelAdapter("vellar-session"),
    refreshIntervalMs: 5 * 60 * 1000,
  }
);

// Chrome extension
const store = createSessionStore(
  createChromeStorageAdapter(),
  {
    broadcast: createExtensionBroadcastAdapter(), // custom wrapper
  }
);

// Single-tab app or SSR
const store = createSessionStore(createMemoryStorageAdapter());
// No broadcast = tabs operate independently
```
