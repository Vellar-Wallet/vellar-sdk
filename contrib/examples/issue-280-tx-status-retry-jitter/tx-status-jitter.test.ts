import { describe, expect, it, vi } from "vitest";
import type { TxStatus, TxStatusReader } from "../../../src/tx-status";
import { TransactionTimeoutError } from "../../../src/tx-status";
import { computeJitteredDelay, waitForTransactionJittered } from "./tx-status-jitter";

function readerReturning(statuses: TxStatus[]): TxStatusReader {
  const queue = [...statuses];
  return {
    getStatus: vi.fn().mockImplementation(async () => queue.shift() ?? "pending"),
  };
}

const instantSleep = vi.fn().mockResolvedValue(undefined);

describe("computeJitteredDelay", () => {
  it("produces a distribution of delays, not a fixed value", () => {
    const delays = new Set<number>();
    for (let i = 0; i < 50; i++) {
      delays.add(computeJitteredDelay(1000, { jitterFactor: 0.5 }));
    }
    // With real randomness, 50 draws from a continuous range should not all
    // collapse to the same value — this is the whole point of jitter.
    expect(delays.size).toBeGreaterThan(1);
  });

  it("stays within [0, intervalMs * (1 + jitterFactor)]", () => {
    for (let i = 0; i < 200; i++) {
      const delay = computeJitteredDelay(1000, { jitterFactor: 0.5 });
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(1500);
    }
  });

  it("is deterministic given an injected random source", () => {
    expect(computeJitteredDelay(1000, { jitterFactor: 0.5, random: () => 0 })).toBe(0);
    expect(computeJitteredDelay(1000, { jitterFactor: 0.5, random: () => 1 })).toBe(1500);
    expect(computeJitteredDelay(1000, { jitterFactor: 0, random: () => 0.7 })).toBeCloseTo(700, 5);
  });

  it("never exceeds the configured maxDelayMs bound, however large jitterFactor is", () => {
    const delay = computeJitteredDelay(1000, {
      jitterFactor: 100,
      maxDelayMs: 2000,
      random: () => 1,
    });
    expect(delay).toBeLessThanOrEqual(2000);
  });

  it("defaults maxDelayMs to 10x intervalMs when not given", () => {
    const delay = computeJitteredDelay(1000, { jitterFactor: 100, random: () => 1 });
    expect(delay).toBeLessThanOrEqual(10_000);
  });

  it("rejects a negative intervalMs, jitterFactor, or maxDelayMs", () => {
    expect(() => computeJitteredDelay(-1)).toThrow(RangeError);
    expect(() => computeJitteredDelay(1000, { jitterFactor: -1 })).toThrow(RangeError);
    expect(() => computeJitteredDelay(1000, { maxDelayMs: -1 })).toThrow(RangeError);
  });
});

describe("waitForTransactionJittered", () => {
  it("resolves success immediately when already final", async () => {
    await expect(
      waitForTransactionJittered(readerReturning(["success"]), "h", { sleep: instantSleep }),
    ).resolves.toBe("success");
  });

  it("polls through pending states until success", async () => {
    const reader = readerReturning(["pending", "pending", "success"]);
    await expect(
      waitForTransactionJittered(reader, "h", { sleep: instantSleep, intervalMs: 10 }),
    ).resolves.toBe("success");
    expect(reader.getStatus).toHaveBeenCalledTimes(3);
  });

  it("resolves failed as a final state, not an exception", async () => {
    await expect(
      waitForTransactionJittered(readerReturning(["pending", "failed"]), "h", {
        sleep: instantSleep,
      }),
    ).resolves.toBe("failed");
  });

  it("throws TransactionTimeoutError when the deadline passes while pending", async () => {
    let time = 0;
    const sleep = vi.fn().mockImplementation(async (ms: number) => {
      time += ms;
    });
    await expect(
      waitForTransactionJittered(readerReturning([]), "h", {
        timeoutMs: 50,
        intervalMs: 20,
        sleep,
        now: () => time,
        random: () => 1, // worst case: always the maximum jittered delay
      }),
    ).rejects.toBeInstanceOf(TransactionTimeoutError);
  });

  it("propagates reader errors", async () => {
    const reader: TxStatusReader = { getStatus: vi.fn().mockRejectedValue(new Error("rpc down")) };
    await expect(
      waitForTransactionJittered(reader, "h", { sleep: instantSleep }),
    ).rejects.toThrow("rpc down");
  });

  it("uses delays that vary across polls rather than a fixed interval", async () => {
    const reader = readerReturning(["pending", "pending", "pending", "success"]);
    const delaysSeen: number[] = [];
    const sleep = vi.fn().mockImplementation(async (ms: number) => {
      delaysSeen.push(ms);
    });

    await waitForTransactionJittered(reader, "h", {
      intervalMs: 1000,
      jitterFactor: 0.5,
      sleep,
    });

    expect(delaysSeen).toHaveLength(3);
    // Real randomness across three draws should not all land on the same
    // fixed value the way the un-jittered implementation would.
    expect(new Set(delaysSeen).size).toBeGreaterThan(1);
    for (const d of delaysSeen) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1500);
    }
  });

  it("never sleeps longer than the configured maxDelayMs even with a large jitterFactor", async () => {
    const reader = readerReturning(["pending", "pending", "success"]);
    const delaysSeen: number[] = [];
    const sleep = vi.fn().mockImplementation(async (ms: number) => {
      delaysSeen.push(ms);
    });

    await waitForTransactionJittered(reader, "h", {
      intervalMs: 1000,
      jitterFactor: 50,
      maxDelayMs: 1200,
      sleep,
      random: () => 1,
    });

    for (const d of delaysSeen) {
      expect(d).toBeLessThanOrEqual(1200);
    }
  });
});
