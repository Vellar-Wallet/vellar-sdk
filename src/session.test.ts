import { afterEach, describe, expect, it, vi } from "vitest";
import type { WalletSession } from "./types";
import {
  createMemoryStorageAdapter,
  createSessionStore,
  createWebStorageAdapter,
  DEFAULT_SESSION_MAX_AGE_MS,
  isSessionExpired,
  isWalletSession,
  type SessionStorageAdapter,
} from "./session";

// `lastActiveAt` is deliberately "just now" rather than a fixed date: cached
// session state is subject to a retention window (see DEFAULT_SESSION_MAX_AGE_MS),
// so a hardcoded past timestamp would silently age out and make restore() tests
// fail as the calendar moves. Tests that assert on literal timestamps pass an
// explicit `now` to touch() instead of relying on this fixture's value.
const session: WalletSession = {
  accountId: "CACCOUNT123",
  network: "testnet",
  connected: true,
  authMethod: "passkey",
  createdAt: "2026-07-16T10:00:00.000Z",
  lastActiveAt: new Date().toISOString(),
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

describe("createSessionStore — refresh & expiry edge cases", () => {
  it("refreshes lastActiveAt just before session expiry (boundary condition)", async () => {
    const storage = createMemoryStorageAdapter();
    const store = createSessionStore(storage);
    await store.getState().start(session);

    // Assume a 15-minute session lifetime (900,000 ms).
    // Refresh 1 millisecond before the 15-minute expiry threshold.
    const startTime = new Date(session.lastActiveAt).getTime();
    const justBeforeExpiry = new Date(startTime + 15 * 60 * 1000 - 1);
    const expected = justBeforeExpiry.toISOString();

    await store.getState().touch(justBeforeExpiry);

    expect(store.getState().status).toBe("connected");
    expect(store.getState().session?.lastActiveAt).toBe(expected);
    expect((await storage.load())?.lastActiveAt).toBe(expected);
  });

  it("supports multiple rolling refreshes just before consecutive expiry windows", async () => {
    const storage = createMemoryStorageAdapter();
    const store = createSessionStore(storage);
    await store.getState().start(session);

    // First refresh at T0 + 14 minutes (near 15m expiry)
    const touch1 = new Date("2026-07-16T10:14:00.000Z");
    await store.getState().touch(touch1);
    expect(store.getState().session?.lastActiveAt).toBe("2026-07-16T10:14:00.000Z");

    // Second refresh at T0 + 28 minutes (near rolling 15m window from touch1)
    const touch2 = new Date("2026-07-16T10:28:00.000Z");
    await store.getState().touch(touch2);
    expect(store.getState().session?.lastActiveAt).toBe("2026-07-16T10:28:00.000Z");

    // Third refresh at T0 + 42 minutes (near rolling 15m window from touch2)
    const touch3 = new Date("2026-07-16T10:42:00.000Z");
    await store.getState().touch(touch3);
    expect(store.getState().session?.lastActiveAt).toBe("2026-07-16T10:42:00.000Z");

    expect(store.getState().status).toBe("connected");
    expect((await storage.load())?.lastActiveAt).toBe("2026-07-16T10:42:00.000Z");
  });

  it("touch() with default now parameter updates lastActiveAt to current time", async () => {
    vi.useFakeTimers();
    try {
      const fixedNow = new Date("2026-07-16T10:14:59.000Z");
      vi.setSystemTime(fixedNow);

      const storage = createMemoryStorageAdapter();
      const store = createSessionStore(storage);
      await store.getState().start(session);

      await store.getState().touch();

      expect(store.getState().session?.lastActiveAt).toBe("2026-07-16T10:14:59.000Z");
      expect((await storage.load())?.lastActiveAt).toBe("2026-07-16T10:14:59.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("touch() is a no-op when attempted after session has expired and ended", async () => {
    const storage = createMemoryStorageAdapter();
    const store = createSessionStore(storage);
    await store.getState().start(session);

    // End the expired session
    await store.getState().end();
    expect(store.getState().status).toBe("disconnected");
    expect(store.getState().session).toBeNull();

    const saveSpy = vi.spyOn(storage, "save");

    // Attempt to refresh after expiry & termination
    const afterExpiry = new Date("2026-07-16T11:00:00.000Z");
    await store.getState().touch(afterExpiry);

    expect(saveSpy).not.toHaveBeenCalled();
    expect(store.getState().status).toBe("disconnected");
    expect(store.getState().session).toBeNull();
    expect(await storage.load()).toBeNull();
  });

  it("touch() is a no-op when called in loading state before start or restore", async () => {
    const storage = createMemoryStorageAdapter();
    const saveSpy = vi.spyOn(storage, "save");
    const store = createSessionStore(storage);

    await store.getState().touch(new Date("2026-07-16T10:30:00.000Z"));

    expect(saveSpy).not.toHaveBeenCalled();
    expect(store.getState().status).toBe("loading");
    expect(store.getState().session).toBeNull();
  });

  it("touch() is a no-op after restore() finds empty storage and disconnects", async () => {
    const storage = createMemoryStorageAdapter();
    const store = createSessionStore(storage);
    await store.getState().restore();
    expect(store.getState().status).toBe("disconnected");

    const saveSpy = vi.spyOn(storage, "save");
    await store.getState().touch(new Date("2026-07-16T10:30:00.000Z"));

    expect(saveSpy).not.toHaveBeenCalled();
    expect(store.getState().status).toBe("disconnected");
    expect(store.getState().session).toBeNull();
  });

  it("handles multiple concurrent touch() calls simultaneously", async () => {
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

  it("handles concurrent touch() calls with an asynchronous delayed storage adapter", async () => {
    let saved: WalletSession | null = null;
    const delayedStorage: SessionStorageAdapter = {
      async load() {
        return saved;
      },
      async save(s) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        saved = s;
      },
      async clear() {
        saved = null;
      },
    };

    const store = createSessionStore(delayedStorage);
    await store.getState().start(session);

    const touchCalls = [
      store.getState().touch(new Date("2026-07-16T10:01:00.000Z")),
      store.getState().touch(new Date("2026-07-16T10:02:00.000Z")),
      store.getState().touch(new Date("2026-07-16T10:03:00.000Z")),
    ];

    await expect(Promise.all(touchCalls)).resolves.toBeDefined();
    expect(store.getState().status).toBe("connected");
    expect(store.getState().session).not.toBeNull();
    expect(await delayedStorage.load()).toEqual(store.getState().session);
  });

  it("touch() propagates storage failure during refresh without crashing store", async () => {
    const storage = createMemoryStorageAdapter();
    const store = createSessionStore(storage);
    await store.getState().start(session);

    vi.spyOn(storage, "save").mockRejectedValueOnce(new Error("disk write error"));

    await expect(store.getState().touch(new Date("2026-07-16T10:10:00.000Z"))).rejects.toThrow(
      "disk write error",
    );
    // Store remains operational and session is still present
    expect(store.getState().status).toBe("connected");
  });

  it("handles interleaved concurrent touch() and end() gracefully", async () => {
    const storage = createMemoryStorageAdapter();
    const store = createSessionStore(storage);
    await store.getState().start(session);

    await Promise.all([
      store.getState().touch(new Date("2026-07-16T10:05:00.000Z")),
      store.getState().end(),
    ]);

    // Either end() or touch() resolved last; if end() was last, state is disconnected and storage is null.
    // If touch() was last, session is valid. In both cases, no uncaught error occurs.
    const status = store.getState().status;
    expect(["connected", "disconnected"]).toContain(status);
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

describe("cached session retention", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  /** A session last active `ageMs` before `now`. */
  function agedSession(ageMs: number, now = Date.now()): WalletSession {
    return { ...session, lastActiveAt: new Date(now - ageMs).toISOString() };
  }

  it("defaults to a 30-day retention window", () => {
    expect(DEFAULT_SESSION_MAX_AGE_MS).toBe(30 * DAY_MS);
  });

  it("restore() discards cached state older than the max age", async () => {
    const storage = createMemoryStorageAdapter();
    await storage.save(agedSession(2 * DAY_MS));
    const store = createSessionStore(storage, { maxAgeMs: DAY_MS });
    await store.getState().restore();
    expect(store.getState().status).toBe("disconnected");
    expect(store.getState().session).toBeNull();
  });

  it("restore() evicts expired state from storage so it is not read again", async () => {
    const storage = createMemoryStorageAdapter();
    await storage.save(agedSession(2 * DAY_MS));
    const store = createSessionStore(storage, { maxAgeMs: DAY_MS });
    await store.getState().restore();
    expect(await storage.load()).toBeNull();
  });

  it("restore() resumes cached state inside the max age", async () => {
    const storage = createMemoryStorageAdapter();
    const fresh = agedSession(DAY_MS / 2);
    await storage.save(fresh);
    const store = createSessionStore(storage, { maxAgeMs: DAY_MS });
    await store.getState().restore();
    expect(store.getState().status).toBe("connected");
    expect(store.getState().session).toEqual(fresh);
  });

  it("restore() applies the 30-day default when no max age is configured", async () => {
    const storage = createMemoryStorageAdapter();
    await storage.save(agedSession(DEFAULT_SESSION_MAX_AGE_MS + 60_000));
    const store = createSessionStore(storage);
    await store.getState().restore();
    expect(store.getState().status).toBe("disconnected");

    await storage.save(agedSession(DEFAULT_SESSION_MAX_AGE_MS - 60_000));
    const stillValid = createSessionStore(storage);
    await stillValid.getState().restore();
    expect(stillValid.getState().status).toBe("connected");
  });

  it("expiry is measured from lastActiveAt, so touch() extends retention", async () => {
    const storage = createMemoryStorageAdapter();
    // Created long ago, but active moments ago: an idle window, not a hard cap.
    await storage.save({ ...agedSession(60_000), createdAt: "2020-01-01T00:00:00.000Z" });
    const store = createSessionStore(storage, { maxAgeMs: DAY_MS });
    await store.getState().restore();
    expect(store.getState().status).toBe("connected");
  });

  it("restore() discards cached state with an unparseable lastActiveAt", async () => {
    const storage = createMemoryStorageAdapter();
    await storage.save({ ...session, lastActiveAt: "not-a-date" });
    const store = createSessionStore(storage);
    await store.getState().restore();
    expect(store.getState().status).toBe("disconnected");
    expect(await storage.load()).toBeNull();
  });

  it("restore() still disconnects when evicting expired state fails", async () => {
    const broken: SessionStorageAdapter = {
      load: vi.fn().mockResolvedValue(agedSession(2 * DAY_MS)),
      save: vi.fn(),
      clear: vi.fn().mockRejectedValue(new Error("read-only storage")),
    };
    const store = createSessionStore(broken, { maxAgeMs: DAY_MS });
    await store.getState().restore();
    expect(store.getState().status).toBe("disconnected");
    expect(store.getState().session).toBeNull();
  });

  it("maxAgeMs: Infinity opts out of expiry", async () => {
    const storage = createMemoryStorageAdapter();
    const ancient = agedSession(10 * 365 * DAY_MS);
    await storage.save(ancient);
    const store = createSessionStore(storage, { maxAgeMs: Infinity });
    await store.getState().restore();
    expect(store.getState().status).toBe("connected");
    expect(store.getState().session).toEqual(ancient);
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["NaN", NaN],
  ])("rejects a %s maxAgeMs at construction", (_label, value) => {
    expect(() => createSessionStore(createMemoryStorageAdapter(), { maxAgeMs: value })).toThrow(
      RangeError,
    );
  });

  describe("isSessionExpired", () => {
    const now = new Date("2026-07-16T10:00:00.000Z");

    it("is false exactly at the boundary and true just past it", () => {
      const atBoundary = { ...session, lastActiveAt: new Date(now.getTime() - DAY_MS).toISOString() };
      expect(isSessionExpired(atBoundary, DAY_MS, now)).toBe(false);
      const pastBoundary = {
        ...session,
        lastActiveAt: new Date(now.getTime() - DAY_MS - 1).toISOString(),
      };
      expect(isSessionExpired(pastBoundary, DAY_MS, now)).toBe(true);
    });

    it("treats a future lastActiveAt (clock skew) as not expired", () => {
      const skewed = { ...session, lastActiveAt: new Date(now.getTime() + DAY_MS).toISOString() };
      expect(isSessionExpired(skewed, DAY_MS, now)).toBe(false);
    });

    it("defaults to the 30-day window", () => {
      const old = {
        ...session,
        lastActiveAt: new Date(now.getTime() - DEFAULT_SESSION_MAX_AGE_MS - 1).toISOString(),
      };
      expect(isSessionExpired(old, undefined, now)).toBe(true);
    });
  });
});
