import { describe, expect, it, vi } from "vitest";
import {
  SessionKeyExpiredError,
  checkSessionExpiry,
  withSessionExpiryCheck,
} from "./session-expiry.js";

describe("session-expiry (Issue #425)", () => {
  it("allows signing when key is not expired", async () => {
    const fixedNow = 1_000_000;
    const signer = {
      signAuthEntry: vi.fn().mockResolvedValue("signed-entry"),
    };

    const wrapped = withSessionExpiryCheck(signer, {
      expiresAt: fixedNow + 5000,
      clock: { now: () => fixedNow },
    });

    const res = await wrapped.signAuthEntry({});
    expect(res).toBe("signed-entry");
    expect(signer.signAuthEntry).toHaveBeenCalledOnce();
  });

  it("throws SessionKeyExpiredError when key is expired before signing", async () => {
    const fixedNow = 1_000_000;
    const signer = {
      signAuthEntry: vi.fn(),
    };

    const wrapped = withSessionExpiryCheck(signer, {
      expiresAt: fixedNow - 100,
      clock: { now: () => fixedNow },
    });

    await expect(wrapped.signAuthEntry({})).rejects.toThrowError(SessionKeyExpiredError);
    expect(signer.signAuthEntry).not.toHaveBeenCalled();
  });

  it("triggers onExpiringSoon when within warnThresholdMs", () => {
    const fixedNow = 1_000_000;
    const onExpiringSoon = vi.fn();

    checkSessionExpiry({
      expiresAt: fixedNow + 4000, // 4s remaining
      warnThresholdMs: 5000, // alert if <= 5s
      onExpiringSoon,
      clock: { now: () => fixedNow },
    });

    expect(onExpiringSoon).toHaveBeenCalledWith(4000);
  });

  it("does not trigger onExpiringSoon when outside warnThresholdMs", () => {
    const fixedNow = 1_000_000;
    const onExpiringSoon = vi.fn();

    checkSessionExpiry({
      expiresAt: fixedNow + 10_000, // 10s remaining
      warnThresholdMs: 5000,
      onExpiringSoon,
      clock: { now: () => fixedNow },
    });

    expect(onExpiringSoon).not.toHaveBeenCalled();
  });
});
