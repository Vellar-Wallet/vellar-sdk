import { describe, expect, it, vi } from "vitest";
import {
  createMemoryStorageAdapter,
  createSessionStore,
  createWebStorageAdapter,
  type SessionStorageAdapter,
  type WalletSession,
} from "../src/index.js";
import {
  DEFAULT_SESSION_MAX_AGE_MS,
  isSessionExpired,
  withSessionRetention,
} from "./session-retention.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-07-16T10:00:00.000Z");
const at = () => NOW;

/** A session last active `ageMs` before NOW. */
function agedSession(ageMs: number): WalletSession {
  return {
    accountId: "CACCOUNT123",
    network: "testnet",
    connected: true,
    authMethod: "passkey",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActiveAt: new Date(NOW.getTime() - ageMs).toISOString(),
  };
}

describe("DEFAULT_SESSION_MAX_AGE_MS", () => {
  it("documents a 30-day retention window", () => {
    expect(DEFAULT_SESSION_MAX_AGE_MS).toBe(30 * DAY_MS);
  });
});

describe("withSessionRetention", () => {
  it("discards cached state past the max age on read", async () => {
    const inner = createMemoryStorageAdapter();
    await inner.save(agedSession(2 * DAY_MS));
    const adapter = withSessionRetention(inner, { maxAgeMs: DAY_MS, now: at });
    expect(await adapter.load()).toBeNull();
  });

  it("evicts expired state from storage rather than merely ignoring it", async () => {
    const inner = createMemoryStorageAdapter();
    await inner.save(agedSession(2 * DAY_MS));
    const adapter = withSessionRetention(inner, { maxAgeMs: DAY_MS, now: at });

    await adapter.load();

    // The underlying entry is gone, not just filtered out of the read.
    expect(await inner.load()).toBeNull();
  });

  it("returns cached state inside the max age untouched", async () => {
    const inner = createMemoryStorageAdapter();
    const fresh = agedSession(DAY_MS / 2);
    await inner.save(fresh);
    const adapter = withSessionRetention(inner, { maxAgeMs: DAY_MS, now: at });

    expect(await adapter.load()).toEqual(fresh);
    expect(await inner.load()).toEqual(fresh);
  });

  it("applies the 30-day default when no max age is configured", async () => {
    const inner = createMemoryStorageAdapter();
    const adapter = withSessionRetention(inner, { now: at });

    await inner.save(agedSession(DEFAULT_SESSION_MAX_AGE_MS + 60_000));
    expect(await adapter.load()).toBeNull();

    const stillValid = agedSession(DEFAULT_SESSION_MAX_AGE_MS - 60_000);
    await inner.save(stillValid);
    expect(await adapter.load()).toEqual(stillValid);
  });

  it("passes through a null read without touching storage", async () => {
    const inner = createMemoryStorageAdapter();
    const clear = vi.spyOn(inner, "clear");
    const adapter = withSessionRetention(inner, { now: at });

    expect(await adapter.load()).toBeNull();
    expect(clear).not.toHaveBeenCalled();
  });

  it("discards cached state with an unparseable lastActiveAt", async () => {
    const inner = createMemoryStorageAdapter();
    await inner.save({ ...agedSession(0), lastActiveAt: "not-a-date" });
    const adapter = withSessionRetention(inner, { now: at });

    expect(await adapter.load()).toBeNull();
    expect(await inner.load()).toBeNull();
  });

  it("still reports expiry when eviction fails on read-only storage", async () => {
    const broken: SessionStorageAdapter = {
      load: vi.fn().mockResolvedValue(agedSession(2 * DAY_MS)),
      save: vi.fn(),
      clear: vi.fn().mockRejectedValue(new Error("read-only storage")),
    };
    const adapter = withSessionRetention(broken, { maxAgeMs: DAY_MS, now: at });

    // A failing clear() must not resurrect the session or reject the read.
    await expect(adapter.load()).resolves.toBeNull();
  });

  it("propagates read failures from the underlying adapter", async () => {
    const broken: SessionStorageAdapter = {
      load: vi.fn().mockRejectedValue(new Error("corrupt")),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const adapter = withSessionRetention(broken, { now: at });

    // restore() maps this to "disconnected"; the wrapper must not swallow it.
    await expect(adapter.load()).rejects.toThrow("corrupt");
  });

  it("maxAgeMs: Infinity opts out of expiry", async () => {
    const inner = createMemoryStorageAdapter();
    const ancient = agedSession(10 * 365 * DAY_MS);
    await inner.save(ancient);
    const adapter = withSessionRetention(inner, { maxAgeMs: Infinity, now: at });

    expect(await adapter.load()).toEqual(ancient);
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["NaN", NaN],
  ])("rejects a %s maxAgeMs at wiring time", (_label, value) => {
    expect(() => withSessionRetention(createMemoryStorageAdapter(), { maxAgeMs: value })).toThrow(
      RangeError,
    );
  });

  it("delegates save() and clear() to the wrapped adapter", async () => {
    const inner = createMemoryStorageAdapter();
    const adapter = withSessionRetention(inner, { now: at });
    const session = agedSession(0);

    await adapter.save(session);
    expect(await inner.load()).toEqual(session);

    await adapter.clear();
    expect(await inner.load()).toBeNull();
  });
});

describe("isSessionExpired", () => {
  it("is false exactly at the boundary and true just past it", () => {
    expect(isSessionExpired(agedSession(DAY_MS), DAY_MS, NOW)).toBe(false);
    expect(isSessionExpired(agedSession(DAY_MS + 1), DAY_MS, NOW)).toBe(true);
  });

  it("treats a future lastActiveAt (clock skew) as not expired", () => {
    expect(isSessionExpired(agedSession(-DAY_MS), DAY_MS, NOW)).toBe(false);
  });

  it("defaults to the 30-day window", () => {
    expect(isSessionExpired(agedSession(DEFAULT_SESSION_MAX_AGE_MS + 1), undefined, NOW)).toBe(true);
    expect(isSessionExpired(agedSession(DEFAULT_SESSION_MAX_AGE_MS - 1), undefined, NOW)).toBe(
      false,
    );
  });
});

describe("createSessionStore with a retention-wrapped adapter", () => {
  it("restore() disconnects when the cached state has aged out", async () => {
    const inner = createMemoryStorageAdapter();
    await inner.save(agedSession(2 * DAY_MS));
    const store = createSessionStore(withSessionRetention(inner, { maxAgeMs: DAY_MS, now: at }));

    await store.getState().restore();

    expect(store.getState().status).toBe("disconnected");
    expect(store.getState().session).toBeNull();
    expect(await inner.load()).toBeNull();
  });

  it("restore() resumes cached state inside the window", async () => {
    const inner = createMemoryStorageAdapter();
    const fresh = agedSession(DAY_MS / 2);
    await inner.save(fresh);
    const store = createSessionStore(withSessionRetention(inner, { maxAgeMs: DAY_MS, now: at }));

    await store.getState().restore();

    expect(store.getState().status).toBe("connected");
    expect(store.getState().session).toEqual(fresh);
  });

  it("retention is an idle timeout: an old createdAt still restores", async () => {
    const inner = createMemoryStorageAdapter();
    // Created long ago, active moments ago.
    await inner.save({ ...agedSession(60_000), createdAt: "2020-01-01T00:00:00.000Z" });
    const store = createSessionStore(withSessionRetention(inner, { maxAgeMs: DAY_MS, now: at }));

    await store.getState().restore();

    expect(store.getState().status).toBe("connected");
  });

  it("touch() renews the window, so an active session does not age out", async () => {
    const inner = createMemoryStorageAdapter();
    const adapter = withSessionRetention(inner, { maxAgeMs: DAY_MS, now: at });
    const store = createSessionStore(adapter);

    await store.getState().start(agedSession(2 * DAY_MS));
    // Activity refreshes lastActiveAt, bringing the entry back inside the window.
    await store.getState().touch(NOW);

    const restored = createSessionStore(adapter);
    await restored.getState().restore();
    expect(restored.getState().status).toBe("connected");
  });

  it("works through the web storage adapter consumers actually use", async () => {
    const map = new Map<string, string>();
    const backing = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
    map.set("vellar.session", JSON.stringify(agedSession(2 * DAY_MS)));

    const store = createSessionStore(
      withSessionRetention(createWebStorageAdapter(backing), { maxAgeMs: DAY_MS, now: at }),
    );
    await store.getState().restore();

    expect(store.getState().status).toBe("disconnected");
    expect(map.has("vellar.session")).toBe(false);
  });
});
