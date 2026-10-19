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

  it("keeps polling through transient reader errors and recovers", async () => {
    let calls = 0;
    const reader: TxStatusReader = {
      getStatus: vi.fn().mockImplementation(async () => {
        calls += 1;
        if (calls <= 2) throw new Error("rpc down"); // drop mid-poll, then recover
        return calls <= 3 ? "pending" : "success";
      }),
    };
    await expect(
      waitForTransaction(reader, "h", { sleep: instantSleep, intervalMs: 10, timeoutMs: 1000 }),
    ).resolves.toBe("success");
    expect(reader.getStatus).toHaveBeenCalledTimes(4);
  });

  it("throws TransactionTimeoutError when the network stays down past the deadline", async () => {
    let time = 0;
    const reader: TxStatusReader = {
      getStatus: vi.fn().mockRejectedValue(new Error("rpc down")),
    };
    const sleep = vi.fn().mockImplementation(async (ms: number) => {
      time += ms;
    });
    await expect(
      waitForTransaction(reader, "h", {
        timeoutMs: 50,
        intervalMs: 20,
        sleep,
        now: () => time,
      }),
    ).rejects.toBeInstanceOf(TransactionTimeoutError);
    // It polled (attempted) repeatedly rather than bailing on the first error.
    expect(reader.getStatus).toHaveBeenCalledTimes(3);
  });
});

describe("waitForTransaction with a stuck relayer job", () => {
  function stuckRelayer() {
    let time = 0;
    const reader: TxStatusReader = { getStatus: vi.fn().mockResolvedValue("pending") };
    const sleep = vi.fn().mockImplementation(async (ms: number) => {
      time += ms;
    });
    return { reader, sleep, now: () => time };
  }

  it("stops polling at the timeout instead of polling indefinitely", async () => {
    const { reader, sleep, now } = stuckRelayer();
    await expect(
      waitForTransaction(reader, "h", { timeoutMs: 1000, intervalMs: 100, sleep, now }),
    ).rejects.toBeInstanceOf(TransactionTimeoutError);
    expect(reader.getStatus).toHaveBeenCalledTimes(11);
  });

  it("uses a 60s deadline at 2s intervals by default", async () => {
    const { reader, sleep, now } = stuckRelayer();
    await expect(waitForTransaction(reader, "h", { sleep, now })).rejects.toBeInstanceOf(
      TransactionTimeoutError,
    );
    expect(reader.getStatus).toHaveBeenCalledTimes(31);
  });

  it("names the error and says the relayer never reported a final status, not an on-chain failure", async () => {
    const { reader, sleep, now } = stuckRelayer();
    const err = (await waitForTransaction(reader, "abc123", {
      timeoutMs: 100,
      intervalMs: 50,
      sleep,
      now,
    }).catch((e: unknown) => e)) as TransactionTimeoutError;
    expect(err.name).toBe("TransactionTimeoutError");
    expect(err.hash).toBe("abc123");
    expect(err.timeoutMs).toBe(100);
    expect(err.message).toMatch(/never reported a final status/);
    expect(err.message).toMatch(/not an on-chain failure/);
  });

  it("reports an on-chain failure as a resolved failed status, never as the timeout error", async () => {
    await expect(
      waitForTransaction(readerReturning(["pending", "failed"]), "h", { sleep: instantSleep }),
    ).resolves.toBe("failed");
  });
});
