import { describe, expect, it } from "vitest";
import { waitForTransaction, type TxStatus, type TxStatusReader } from "./tx-status";

// Chaos test for tx-rpc polling under simulated network drops.
//
// A `TxStatusReader` is the seam `tx-rpc.ts` (createRpcTxStatusReader) fills
// with a live rpc.Server.getTransaction call. This harness swaps in a reader
// that throws exactly as the RPC does when the network drops mid-poll, then
// "recovers" and starts answering again. The point is to prove that
// waitForTransaction — the polling loop that consumes that reader — resumes
// after the drop, keeps polling, and eventually resolves with the correct final
// status instead of wedging or failing on the first transient error.
//
// Scenario documented in CONTRIBUTING.md (Testing → tx-rpc chaos test).

/** A reader that simulates `dropCount` network failures, then serves `statuses`. */
function droppingReader(dropCount: number, statuses: TxStatus[]): { reader: TxStatusReader; attempts: number[] } {
  const attempts: number[] = [];
  const queue = [...statuses];
  let dropsRemaining = dropCount;
  return {
    attempts,
    reader: {
      async getStatus(): Promise<TxStatus> {
        attempts.push(1);
        if (dropsRemaining > 0) {
          dropsRemaining -= 1;
          throw new Error("boom: network dropped while polling");
        }
        return queue.shift() ?? "pending";
      },
    },
  };
}

const instantSleep = async () => {};

describe("tx-rpc polling chaos: network drops mid-poll", () => {
  it("recovers and resolves success after a transient drop", async () => {
    const { reader, attempts } = droppingReader(2, ["pending", "pending", "success"]);
    const result = await waitForTransaction(reader, "h", {
      sleep: instantSleep,
      intervalMs: 1,
      timeoutMs: 1000,
    });

    expect(result).toBe("success");
    // 2 dropped attempts + 2 pending polls + 1 final success poll.
    expect(attempts).toHaveLength(5);
  });

  it("recovers and lands on failed (a final status, not an exception)", async () => {
    const { reader } = droppingReader(1, ["pending", "failed"]);
    const result = await waitForTransaction(reader, "h", {
      sleep: instantSleep,
      intervalMs: 1,
      timeoutMs: 1000,
    });

    expect(result).toBe("failed");
  });

  it("recovers through multiple back-to-back drops before resolving", async () => {
    const { reader, attempts } = droppingReader(5, ["pending", "success"]);
    const result = await waitForTransaction(reader, "h", {
      sleep: instantSleep,
      intervalMs: 1,
      timeoutMs: 1000,
    });

    expect(result).toBe("success");
    // 5 dropped attempts + 1 pending poll + 1 final success poll.
    expect(attempts).toHaveLength(7);
  });

  it("asserts the final transaction status is exactly success after recovery", async () => {
    // The status that gate-crashes out of the drop is "success" — assert it,
    // and that no earlier poll yielded a final state we could have mistaken it for.
    const { reader } = droppingReader(3, ["pending", "success"]);
    const result = await waitForTransaction(reader, "h", {
      sleep: instantSleep,
      intervalMs: 1,
      timeoutMs: 1000,
    });

    expect(result).toBe("success");
  });
});
