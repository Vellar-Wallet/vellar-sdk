import { describe, expect, it, vi } from "vitest";
import { PollTimeoutError, pollUntilFinal, type StatusFn } from "./poll-until-final";

const noSleep = vi.fn(async () => {});

describe("pollUntilFinal", () => {
  it("resolves as soon as a non-pending status is seen", async () => {
    let calls = 0;
    const getStatus: StatusFn = async () => {
      calls++;
      return calls < 3 ? "pending" : "success";
    };

    const result = await pollUntilFinal(getStatus, "hash", {
      intervalMs: 10,
      maxAttempts: 5,
      sleep: noSleep,
    });

    expect(result).toBe("success");
    expect(calls).toBe(3);
  });

  it("resolves with 'failed' when that's the reported status", async () => {
    const getStatus: StatusFn = async () => "failed";
    await expect(
      pollUntilFinal(getStatus, "hash", { intervalMs: 10, maxAttempts: 3, sleep: noSleep }),
    ).resolves.toBe("failed");
  });

  it("rejects with PollTimeoutError once attempts are exhausted", async () => {
    const getStatus: StatusFn = async () => "pending";
    await expect(
      pollUntilFinal(getStatus, "hash", { intervalMs: 10, maxAttempts: 3, sleep: noSleep }),
    ).rejects.toThrow(PollTimeoutError);
  });

  it("calls getStatus exactly maxAttempts times when never final", async () => {
    let calls = 0;
    const getStatus: StatusFn = async () => {
      calls++;
      return "pending";
    };
    await expect(
      pollUntilFinal(getStatus, "hash", { intervalMs: 10, maxAttempts: 4, sleep: noSleep }),
    ).rejects.toThrow();
    expect(calls).toBe(4);
  });

  it("does not sleep after the final attempt", async () => {
    const sleep = vi.fn(async () => {});
    const getStatus: StatusFn = async () => "pending";
    await expect(
      pollUntilFinal(getStatus, "hash", { intervalMs: 10, maxAttempts: 3, sleep }),
    ).rejects.toThrow();
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
