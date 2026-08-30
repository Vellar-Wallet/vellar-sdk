import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  startRefreshScheduler,
  type ExpiringSession,
  type RefreshFn,
} from "./session-refresh-scheduler";

/** A session expiring `ms` from the (faked) current time. */
function sessionExpiringInMs(ms: number): ExpiringSession {
  return { expiresAt: new Date(Date.now() + ms).toISOString() };
}

describe("startRefreshScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires the refresh leadTimeMs before expiry and reschedules on the new expiry", async () => {
    const lifetimeMs = 1000;
    const leadTimeMs = 200;
    // Each refresh returns a fresh session with the same lifetime.
    const refresh: RefreshFn = vi.fn(async () => sessionExpiringInMs(lifetimeMs));

    const scheduler = startRefreshScheduler(sessionExpiringInMs(lifetimeMs), refresh, {
      leadTimeMs,
    });

    // Nothing fires before the lead-time window (fire point is at 800ms).
    await vi.advanceTimersByTimeAsync(lifetimeMs - leadTimeMs - 1);
    expect(refresh).not.toHaveBeenCalled();

    // Crossing the lead point triggers the first refresh...
    await vi.advanceTimersByTimeAsync(2);
    expect(refresh).toHaveBeenCalledTimes(1);

    // ...and it reschedules itself: another full cycle triggers a second refresh.
    await vi.advanceTimersByTimeAsync(lifetimeMs - leadTimeMs);
    expect(refresh).toHaveBeenCalledTimes(2);

    scheduler.stop();
  });

  it("stop() clears the pending timer so no further refresh runs", async () => {
    const refresh: RefreshFn = vi.fn(async () => sessionExpiringInMs(1000));
    const scheduler = startRefreshScheduler(sessionExpiringInMs(1000), refresh, {
      leadTimeMs: 200,
    });

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("fires immediately (delay clamped to 0) when expiry is already within the lead time", async () => {
    const refresh: RefreshFn = vi.fn(async () => sessionExpiringInMs(1000));
    // Expiry 50ms out but lead time is 200ms => fire point already passed.
    const scheduler = startRefreshScheduler(sessionExpiringInMs(50), refresh, {
      leadTimeMs: 200,
    });

    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it("routes a refresh error to onError and stops rescheduling", async () => {
    const onError = vi.fn();
    const refresh: RefreshFn = vi.fn(async () => {
      throw new Error("mint failed");
    });
    const scheduler = startRefreshScheduler(sessionExpiringInMs(1000), refresh, {
      leadTimeMs: 200,
      onError,
    });

    await vi.advanceTimersByTimeAsync(2000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);

    scheduler.stop();
  });

  it("throws synchronously if the initial session has an invalid expiresAt", () => {
    const refresh: RefreshFn = vi.fn(async () => sessionExpiringInMs(1000));
    expect(() =>
      startRefreshScheduler({ expiresAt: "not-a-date" }, refresh, { leadTimeMs: 100 }),
    ).toThrow(RangeError);
  });
});
