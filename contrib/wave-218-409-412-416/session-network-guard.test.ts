import { describe, expect, it, vi } from "vitest";
import type { SessionStorageAdapter } from "../../src/session";
import type { WalletSession } from "../../src/types";
import { createSessionStoreWithNetworkGuard } from "./session-network-guard";

function createMemoryStorage(initial: WalletSession | null = null): SessionStorageAdapter & {
  stored: WalletSession | null;
  clearCalls: number;
} {
  return {
    stored: initial,
    clearCalls: 0,
    async load() {
      return this.stored;
    },
    async save(session) {
      this.stored = session;
    },
    async clear() {
      this.clearCalls++;
      this.stored = null;
    },
  };
}

const mockSession: WalletSession = {
  accountId: "GBTESTACCOUNTID123",
  network: "testnet",
  connected: true,
  authMethod: "passkey",
  createdAt: "2026-09-01T00:00:00.000Z",
  lastActiveAt: "2026-09-01T00:00:00.000Z",
};

describe("session network guard (#409)", () => {
  it("restores session when network matches expectedNetwork", async () => {
    const storage = createMemoryStorage(mockSession);
    const store = createSessionStoreWithNetworkGuard(storage, {
      expectedNetwork: "testnet",
    });

    await store.getState().restore();

    expect(store.getState().status).toBe("connected");
    expect(store.getState().session?.accountId).toBe(mockSession.accountId);
    expect(store.getState().disconnectReason).toBeNull();
    expect(storage.clearCalls).toBe(0);
  });

  it("restores session when expectedNetwork is omitted", async () => {
    const storage = createMemoryStorage(mockSession);
    const store = createSessionStoreWithNetworkGuard(storage);

    await store.getState().restore();

    expect(store.getState().status).toBe("connected");
    expect(store.getState().session?.network).toBe("testnet");
  });

  it("rejects, clears storage, and disconnects when network mismatches", async () => {
    const storage = createMemoryStorage(mockSession);
    const onMismatch = vi.fn();

    const store = createSessionStoreWithNetworkGuard(storage, {
      expectedNetwork: "mainnet",
      onSessionMismatch: onMismatch,
    });

    await store.getState().restore();

    expect(store.getState().status).toBe("disconnected");
    expect(store.getState().session).toBeNull();
    expect(store.getState().disconnectReason).toBe("network_mismatch");
    expect(storage.clearCalls).toBe(1);
    expect(storage.stored).toBeNull();

    expect(onMismatch).toHaveBeenCalledTimes(1);
    expect(onMismatch).toHaveBeenCalledWith({
      session: mockSession,
      expectedNetwork: "mainnet",
    });
  });

  it("handles corrupted storage gracefully", async () => {
    const corruptStorage: SessionStorageAdapter = {
      async load() {
        throw new Error("Corrupted disk storage");
      },
      async save() {},
      async clear() {},
    };

    const store = createSessionStoreWithNetworkGuard(corruptStorage, {
      expectedNetwork: "testnet",
    });

    await store.getState().restore();

    expect(store.getState().status).toBe("disconnected");
    expect(store.getState().session).toBeNull();
  });
});
