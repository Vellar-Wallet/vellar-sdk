import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoRefreshManager, type ManagedSession } from "./auto-refresh-manager";

/** A managed session expiring `ms` from the (faked) current time. */
function makeSession(expiresInMs: number, keyId: string): ManagedSession {
  const nowIso = new Date().toISOString();
  return {
    accountId: "CTESTWALLET",
    network: "testnet",
    connected: true,
    authMethod: "passkey",
    createdAt: nowIso,
    lastActiveAt: nowIso,
    keyId,
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  };
}

describe("AutoRefreshManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores the initial session and reports it active", () => {
    const refresh = vi.fn(async () => makeSession(1000, "key-2"));
    const manager = new AutoRefreshManager({ leadTimeMs: 200, refresh });

    manager.start(makeSession(1000, "key-1"));
    expect(manager.getSession()?.keyId).toBe("key-1");
    expect(manager.isExpired()).toBe(false);
    manager.stop();
  });

  it("auto-refreshes before expiry and keeps the session live across time", async () => {
    const lifetimeMs = 1000;
    const leadTimeMs = 200;
    let gen = 1;
    const refresh = vi.fn(async (): Promise<ManagedSession> => {
      gen += 1;
      return makeSession(lifetimeMs, `key-${gen}`);
    });

    const manager = new AutoRefreshManager({ leadTimeMs, refresh });
    manager.start(makeSession(lifetimeMs, "key-1"));

    // Fire point is leadTimeMs before expiry, i.e. at 800ms.
    await vi.advanceTimersByTimeAsync(801);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(manager.getSession()?.keyId).toBe("key-2");
    expect(manager.isExpired()).toBe(false);

    // Past the ORIGINAL session's 1000ms expiry — still live because refreshed.
    await vi.advanceTimersByTimeAsync(400); // now at 1201ms
    expect(manager.isExpired()).toBe(false);

    // The refreshed session reschedules itself for a second refresh.
    await vi.advanceTimersByTimeAsync(600); // now at ~1801ms (fire point of gen-2)
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(manager.getSession()?.keyId).toBe("key-3");

    manager.stop();
  });

  it("stop() halts further refreshes", async () => {
    const refresh = vi.fn(async () => makeSession(1000, "later"));
    const manager = new AutoRefreshManager({ leadTimeMs: 200, refresh });

    manager.start(makeSession(1000, "key-1"));
    manager.stop();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reports a lapsed session as expired when refresh is not armed", () => {
    const refresh = vi.fn(async () => makeSession(1000, "x"));
    const manager = new AutoRefreshManager({ leadTimeMs: 200, refresh });

    // Never started: no stored session => treated as expired.
    expect(manager.getSession()).toBeNull();
    expect(manager.isExpired()).toBe(true);
  });

  it("routes a refresh error to onError without crashing", async () => {
    const onError = vi.fn();
    const refresh = vi.fn(async (): Promise<ManagedSession> => {
      throw new Error("rotate failed");
    });
    const manager = new AutoRefreshManager({ leadTimeMs: 200, refresh, onError });

    manager.start(makeSession(1000, "key-1"));
    await vi.advanceTimersByTimeAsync(1000);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    manager.stop();
  });
});
