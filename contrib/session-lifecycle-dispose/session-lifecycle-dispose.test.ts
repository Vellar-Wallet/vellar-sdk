import { afterEach, describe, expect, it, vi } from "vitest";
import type { WalletSession } from "../../src/types";
import { createMemoryStorageAdapter, createSessionStore } from "../../src/session";

/**
 * Test suite for session lifecycle dispose behavior and edge cases.
 * 
 * Issue #795: Validate comprehensive edge cases for dispose() method,
 * including resource cleanup, timer prevention, and concurrent operations.
 */

const session: WalletSession = {
  accountId: "CACCOUNT123",
  network: "testnet",
  connected: true,
  authMethod: "passkey",
  createdAt: "2026-07-16T10:00:00.000Z",
  lastActiveAt: "2026-07-16T10:00:00.000Z",
};

describe("Session Store — Dispose Edge Cases (#795)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dispose() prevents any further touch() operations from executing", async () => {
    vi.useFakeTimers();
    const storage = createMemoryStorageAdapter();
    const save = vi.spyOn(storage, "save");
    const store = createSessionStore(storage);

    await store.getState().start(session);
    const saveCountAfterStart = save.mock.calls.length;

    store.getState().dispose();

    // Attempt manual touch after dispose - should be no-op
    await store.getState().touch(new Date("2026-07-16T12:00:00.000Z"));

    // No additional saves should occur
    expect(save.mock.calls.length).toBe(saveCountAfterStart);
  });

  it("dispose() can be called multiple times without side effects", async () => {
    const storage = createMemoryStorageAdapter();
    const store = createSessionStore(storage);
    await store.getState().start(session);

    // Multiple dispose calls should be idempotent
    store.getState().dispose();
    store.getState().dispose();
    store.getState().dispose();

    expect(store.getState().status).toBe("connected");
    expect(store.getState().session).toEqual(session);
  });

  it("dispose() followed by start() allows normal operation", async () => {
    vi.useFakeTimers();
    const storage = createMemoryStorageAdapter();
    const store = createSessionStore(storage, { refreshIntervalMs: 100 });

    await store.getState().start(session);
    store.getState().dispose();

    // Start a new session after dispose
    const newSession = { ...session, accountId: "CNEWACCOUNT456" };
    await store.getState().start(newSession);

    expect(store.getState().status).toBe("connected");
    expect(store.getState().session?.accountId).toBe("CNEWACCOUNT456");

    // Verify refresh polling works for new session
    const save = vi.spyOn(storage, "save");
    const initialCount = save.mock.calls.length;
    await vi.advanceTimersByTimeAsync(250);
    expect(save.mock.calls.length).toBeGreaterThan(initialCount);
  });

  it("handles concurrent touch() calls with different timestamps", async () => {
    const storage = createMemoryStorageAdapter();
    const store = createSessionStore(storage);
    await store.getState().start(session);

    const times = [
      new Date("2026-07-16T10:01:00.000Z"),
      new Date("2026-07-16T10:02:00.000Z"),
      new Date("2026-07-16T10:03:00.000Z"),
      new Date("2026-07-16T10:04:00.000Z"),
      new Date("2026-07-16T10:05:00.000Z"),
    ];

    // Fire all touch calls concurrently
    await Promise.all(times.map((t) => store.getState().touch(t)));

    expect(store.getState().status).toBe("connected");
    const currentSession = store.getState().session;
    expect(currentSession).not.toBeNull();
    expect(times.map((t) => t.toISOString())).toContain(currentSession?.lastActiveAt);

    const loaded = await storage.load();
    expect(loaded?.lastActiveAt).toBe(currentSession?.lastActiveAt);
  });

  it("handles interleaved concurrent touch() and end() gracefully", async () => {
    const storage = createMemoryStorageAdapter();
    const store = createSessionStore(storage);
    await store.getState().start(session);

    await Promise.all([
      store.getState().touch(new Date("2026-07-16T10:05:00.000Z")),
      store.getState().end(),
    ]);

    // Either end() or touch() resolved last; state should be valid either way
    const status = store.getState().status;
    expect(["connected", "disconnected"]).toContain(status);
  });

  it("dispose after disconnect is safe", async () => {
    const storage = createMemoryStorageAdapter();
    const store = createSessionStore(storage);
    await store.getState().start(session);
    await store.getState().end();

    // Should not throw
    expect(() => store.getState().dispose()).not.toThrow();
    expect(() => store.getState().dispose()).not.toThrow();
  });

  it("touch() is no-op after dispose even with new timestamps", async () => {
    vi.useFakeTimers();
    const storage = createMemoryStorageAdapter();
    const store = createSessionStore(storage);
    await store.getState().start(session);

    store.getState().dispose();

    const save = vi.spyOn(storage, "save");
    const initialCount = save.mock.calls.length;

    // Multiple touch attempts after dispose
    await store.getState().touch(new Date("2026-07-16T12:00:00.000Z"));
    await store.getState().touch(new Date("2026-07-16T12:05:00.000Z"));
    await store.getState().touch(new Date("2026-07-16T12:10:00.000Z"));

    expect(save.mock.calls.length).toBe(initialCount);
  });

  it("refresh polling stops after dispose with fakeTimers", async () => {
    vi.useFakeTimers();
    const storage = createMemoryStorageAdapter();
    const save = vi.spyOn(storage, "save");
    const store = createSessionStore(storage, { refreshIntervalMs: 100 });

    await store.getState().start(session);
    expect(save).toHaveBeenCalledTimes(1); // initial start

    store.getState().dispose();
    await vi.advanceTimersByTimeAsync(10_000);

    // No additional refresh saves
    expect(save).toHaveBeenCalledTimes(1);
  });
});
