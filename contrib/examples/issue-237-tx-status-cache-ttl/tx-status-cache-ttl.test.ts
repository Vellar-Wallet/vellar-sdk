import { describe, expect, it, vi } from "vitest";
import {
  createCachedTxStatusReader,
  waitForTransaction,
  type TxStatus,
  type TxStatusReader,
} from "./tx-status-cache-ttl";

function readerReturning(statuses: TxStatus[]): TxStatusReader {
  const queue = [...statuses];
  return {
    getStatus: vi.fn().mockImplementation(async () => queue.shift() ?? "pending"),
  };
}

const instantSleep = vi.fn().mockResolvedValue(undefined);

describe("tx-status cache TTL", () => {
  it("respects a configured cacheTtlMs for finalized statuses", async () => {
    let time = 0;
    const reader: TxStatusReader = {
      getStatus: vi.fn().mockResolvedValue("success"),
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
