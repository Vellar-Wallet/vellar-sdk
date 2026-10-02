import { describe, expect, it, vi } from "vitest";
import { checkIdleExpiry, logIdleExpiration, type MockSession } from "./session-idle-timeout";

describe("checkIdleExpiry", () => {
  const FIVE_MIN_MS = 5 * 60 * 1000;
  const session: MockSession = {
    accountId: "CACCOUNT",
    lastActiveAt: "2026-07-16T10:00:00.000Z",
  };

  it("reports not expired when idle time is under the timeout", () => {
    const now = new Date("2026-07-16T10:04:59.000Z"); // 4m59s idle
    expect(checkIdleExpiry(session, FIVE_MIN_MS, now)).toEqual({ expired: false });
  });

  it("reports expired with idleForMs when idle time exceeds the timeout", () => {
    const now = new Date("2026-07-16T10:05:01.000Z"); // 5m1s idle
    expect(checkIdleExpiry(session, FIVE_MIN_MS, now)).toEqual({
      expired: true,
      idleForMs: FIVE_MIN_MS + 1000,
    });
  });

  it("treats exactly-at-the-boundary as still valid (exclusive boundary)", () => {
    const now = new Date("2026-07-16T10:05:00.000Z"); // exactly 5m idle
    expect(checkIdleExpiry(session, FIVE_MIN_MS, now)).toEqual({ expired: false });
  });

  it("never treats a future lastActiveAt (clock skew) as expired", () => {
    const skewedSession: MockSession = {
      accountId: "CSKEWED",
      lastActiveAt: "2026-07-16T11:00:00.000Z",
    };
    const now = new Date("2026-07-16T10:00:00.000Z"); // now before lastActiveAt
    expect(checkIdleExpiry(skewedSession, FIVE_MIN_MS, now)).toEqual({ expired: false });
  });
});

describe("logIdleExpiration", () => {
  it("logs the account id and idle duration via console.debug", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    logIdleExpiration({ accountId: "CACCOUNT", lastActiveAt: "2026-07-16T10:00:00.000Z" }, 12345);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("account=CACCOUNT"),
    );
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("idleForMs=12345"));
    spy.mockRestore();
  });
});
