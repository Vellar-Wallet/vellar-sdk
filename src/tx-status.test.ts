import { describe, expect, it, vi } from "vitest";
import {
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
});
