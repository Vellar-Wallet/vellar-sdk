import { describe, expect, it, vi } from "vitest";
import {
  createCachedTxStatusReader,
  TransactionTimeoutError,
  waitForTransaction,
  type TxStatus,
  type TxStatusReader,
} from "./tx-status";

function readerReturning(statuses: TxStatus[]): TxStatusReader {
  const queue = [...statuses];
  return {
    getStatus: vi.fn().mockImplementation(async () => queue.shift() ?? "pending"),
  };
}

const instantSleep = vi.fn().mockResolvedValue(undefined);

describe("waitForTransaction", () => {
  it("resolves success immediately when already final", async () => {
    await expect(
      waitForTransaction(readerReturning(["success"]), "h", { sleep: instantSleep }),
    ).resolves.toBe("success");
  });

  it("polls through pending states until success", async () => {
    const reader = readerReturning(["pending", "pending", "success"]);
    await expect(
      waitForTransaction(reader, "h", { sleep: instantSleep, intervalMs: 10 }),
    ).resolves.toBe("success");
    expect(reader.getStatus).toHaveBeenCalledTimes(3);
  });

  it("resolves failed as a final state, not an exception", async () => {
    await expect(
      waitForTransaction(readerReturning(["pending", "failed"]), "h", { sleep: instantSleep }),
    ).resolves.toBe("failed");
  });

  it("throws TransactionTimeoutError when the deadline passes while pending", async () => {
    let time = 0;
    const sleep = vi.fn().mockImplementation(async (ms: number) => {
      time += ms;
    });
    await expect(
      waitForTransaction(readerReturning([]), "h", {
        timeoutMs: 50,
        intervalMs: 20,
        sleep,
        now: () => time,
      }),
    ).rejects.toBeInstanceOf(TransactionTimeoutError);
  });

  it("propagates reader errors", async () => {
    const reader: TxStatusReader = { getStatus: vi.fn().mockRejectedValue(new Error("rpc down")) };
    await expect(waitForTransaction(reader, "h", { sleep: instantSleep })).rejects.toThrow(
      "rpc down",
    );
  });

  it("respects a configured cacheTtlMs for finalized statuses", async () => {
    let time = 0;
    const reader: TxStatusReader = {
      getStatus: vi
        .fn()
        .mockResolvedValueOnce("success")
        .mockResolvedValueOnce("success"),
    };
    const cached = createCachedTxStatusReader(reader, { cacheTtlMs: 5_000, now: () => time });

    await expect(cached.getStatus("h")).resolves.toBe("success");
    await expect(cached.getStatus("h")).resolves.toBe("success");
    expect(reader.getStatus).toHaveBeenCalledTimes(1);

    time = 5_001;
    await expect(cached.getStatus("h")).resolves.toBe("success");
    expect(reader.getStatus).toHaveBeenCalledTimes(2);
  });

  it("does not cache pending status during polling", async () => {
    const reader = readerReturning(["pending", "pending", "success"]);
    await expect(
      waitForTransaction(reader, "h", {
        sleep: instantSleep,
        intervalMs: 10,
        cacheTtlMs: 60_000,
      }),
    ).resolves.toBe("success");
    expect(reader.getStatus).toHaveBeenCalledTimes(3);
  });

  it("rejects cacheTtlMs outside the valid range", async () => {
    expect(() => createCachedTxStatusReader(readerReturning(["success"]), { cacheTtlMs: -1 })).toThrow(
      RangeError,
    );
    await expect(
      waitForTransaction(readerReturning(["success"]), "h", { cacheTtlMs: 90_000 }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});
