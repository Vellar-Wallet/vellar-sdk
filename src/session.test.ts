import { afterEach, describe, expect, it, vi } from "vitest";
import type { WalletSession } from "./types";
import {
  createMemoryStorageAdapter,
  createSessionStore,
  createWebStorageAdapter,
  isWalletSession,
  type SessionStorageAdapter,
} from "./session";

const session: WalletSession = {
  accountId: "CACCOUNT123",
  network: "testnet",
  connected: true,
  authMethod: "passkey",
  createdAt: "2026-07-16T10:00:00.000Z",
  lastActiveAt: "2026-07-16T10:00:00.000Z",
};

describe("createSessionStore", () => {
  it("starts in loading state", () => {
    const store = createSessionStore(createMemoryStorageAdapter());
    expect(store.getState().status).toBe("loading");
    expect(store.getState().session).toBeNull();
  });

  it("start() connects and persists the session", async () => {
    const storage = createMemoryStorageAdapter();
    const store = createSessionStore(storage);
    await store.getState().start(session);
    expect(store.getState().status).toBe("connected");
    expect(store.getState().session).toEqual(session);
    expect(await storage.load()).toEqual(session);
  });

  it("restore() resumes a persisted session", async () => {
    const storage = createMemoryStorageAdapter();
    await storage.save(session);
    const store = createSessionStore(storage);
    await store.getState().restore();
    expect(store.getState().status).toBe("connected");
    expect(store.getState().session).toEqual(session);
  });

  it("restore() disconnects when nothing is persisted", async () => {
    const store = createSessionStore(createMemoryStorageAdapter());
    await store.getState().restore();
    expect(store.getState().status).toBe("disconnected");
    expect(store.getState().session).toBeNull();
  });

  it("restore() disconnects instead of crashing when storage throws", async () => {
    const broken: SessionStorageAdapter = {
      load: vi.fn().mockRejectedValue(new Error("corrupt")),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const store = createSessionStore(broken);
    await store.getState().restore();
    expect(store.getState().status).toBe("disconnected");
  });

  it("restore() rejects malformed persisted data", async () => {
    const storage = createMemoryStorageAdapter();
    await storage.save({ nonsense: true } as unknown as WalletSession);
    const store = createSessionStore(storage);
    await store.getState().restore();
    expect(store.getState().status).toBe("disconnected");
  });

  it("touch() updates lastActiveAt and persists it", async () => {
    const storage = createMemoryStorageAdapter();
    const store = createSessionStore(storage);
    await store.getState().start(session);
    const later = new Date("2026-07-16T12:34:56.000Z");
    await store.getState().touch(later);
    expect(store.getState().session?.lastActiveAt).toBe("2026-07-16T12:34:56.000Z");
    expect((await storage.load())?.lastActiveAt).toBe("2026-07-16T12:34:56.000Z");
  });

  it("touch() is a no-op when there is no session", async () => {
    const storage = createMemoryStorageAdapter();
    const save = vi.spyOn(storage, "save");
    const store = createSessionStore(storage);
    await store.getState().touch();
    expect(save).not.toHaveBeenCalled();
    expect(store.getState().session).toBeNull();
  });

  it("end() disconnects and clears persisted state", async () => {
    const storage = createMemoryStorageAdapter();
    const store = createSessionStore(storage);
    await store.getState().start(session);
    await store.getState().end();
    expect(store.getState().status).toBe("disconnected");
    expect(store.getState().session).toBeNull();
    expect(await storage.load()).toBeNull();
  });

  it("start() propagates storage failures so callers can surface them", async () => {
    const broken: SessionStorageAdapter = {
      load: vi.fn(),
      save: vi.fn().mockRejectedValue(new Error("quota exceeded")),
      clear: vi.fn(),
    };
    const store = createSessionStore(broken);
    await expect(store.getState().start(session)).rejects.toThrow("quota exceeded");
    expect(store.getState().status).toBe("loading");
  });
});

describe("createSessionStore teardown", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dispose() is idempotent and safe after disconnection", async () => {
    const store = createSessionStore(createMemoryStorageAdapter());
    await store.getState().start(session);
    await store.getState().end();
    expect(() => store.getState().dispose()).not.toThrow();
    expect(() => store.getState().dispose()).not.toThrow();
  });

  it("refresh polling stops any in-progress touch after dispose()", async () => {
    vi.useFakeTimers();
    const storage = createMemoryStorageAdapter();
    const save = vi.spyOn(storage, "save");
    const store = createSessionStore(storage, { refreshIntervalMs: 100 });

    await store.getState().start(session);
    expect(save).toHaveBeenCalledTimes(1); // the initial start() persistence

    store.getState().dispose();
    // Advance well past several intervals — no refresh touch should fire.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).toHaveBeenCalledTimes(1);
    // No dangling reference: the disposed store holds no active timer.
    expect(store.getState().status).toBe("connected");
  });

  it("a started refresh prod is cancelled by end()", async () => {
    vi.useFakeTimers();
    const storage = createMemoryStorageAdapter();
    const save = vi.spyOn(storage, "save");
    const store = createSessionStore(storage, { refreshIntervalMs: 100 });

    await store.getState().start(session);
    await store.getState().end();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(save).toHaveBeenCalledTimes(1); // only the initial start() persistence
  });

  it("refresh polling only runs while connected", async () => {
    vi.useFakeTimers();
    const storage = createMemoryStorageAdapter();
    const save = vi.spyOn(storage, "save");
    const store = createSessionStore(storage, { refreshIntervalMs: 100 });

    // Not connected yet — no polling.
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();

    await store.getState().start(session);
    await vi.advanceTimersByTimeAsync(250);
    // initial start + two ticks at 100ms
    expect(save.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(store.getState().session?.lastActiveAt).not.toBe(session.lastActiveAt);
  });

  it("dispose() clears the timer so the store is garbage-collectable", async () => {
    vi.useFakeTimers();
    const store = createSessionStore(createMemoryStorageAdapter(), {
      refreshIntervalMs: 50,
    });
    await store.getState().start(session);
    store.getState().dispose();
    // No active timers remain after dispose (a leak would fail here by keeping
    // the interval scheduled).
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("createWebStorageAdapter", () => {
  function fakeStorage() {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      map,
    };
  }

  it("round-trips a session under the given key", async () => {
    const backing = fakeStorage();
    const adapter = createWebStorageAdapter(backing, "test.key");
    await adapter.save(session);
    expect(backing.map.has("test.key")).toBe(true);
    expect(await adapter.load()).toEqual(session);
    await adapter.clear();
    expect(await adapter.load()).toBeNull();
  });

  it("returns null for malformed persisted JSON shape", async () => {
    const backing = fakeStorage();
    backing.setItem("vellar.session", JSON.stringify({ accountId: 42 }));
    const adapter = createWebStorageAdapter(backing);
    expect(await adapter.load()).toBeNull();
  });

  it("throws on unparseable JSON (restore() maps this to disconnected)", async () => {
    const backing = fakeStorage();
    backing.setItem("vellar.session", "{not json");
    const adapter = createWebStorageAdapter(backing);
    await expect(adapter.load()).rejects.toThrow();
  });
});

describe("isWalletSession", () => {
  it("accepts a valid session", () => {
    expect(isWalletSession(session)).toBe(true);
  });

  it.each([
    ["null", null],
    ["missing accountId", { ...session, accountId: undefined }],
    ["empty accountId", { ...session, accountId: "" }],
    ["bad network", { ...session, network: "devnet" }],
    ["bad authMethod", { ...session, authMethod: "seed" }],
    ["non-boolean connected", { ...session, connected: "yes" }],
  ])("rejects %s", (_label, value) => {
    expect(isWalletSession(value)).toBe(false);
  });
});
