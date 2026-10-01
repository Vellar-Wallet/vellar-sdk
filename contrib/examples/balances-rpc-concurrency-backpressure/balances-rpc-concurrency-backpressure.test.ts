import { describe, it, expect } from "vitest";
import { ConcurrentBalanceQueue } from "./balances-rpc-concurrency-backpressure";

describe("Issue #243 — Balance RPC Concurrency Backpressure", () => {
  it("limits concurrent executions to maxConcurrency", async () => {
    const queue = new ConcurrentBalanceQueue(2);
    let running = 0;
    let maxRunningObserved = 0;

    const task = async () => {
      running++;
      maxRunningObserved = Math.max(maxRunningObserved, running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
      return true;
    };

    await Promise.all([
      queue.run(task),
      queue.run(task),
      queue.run(task),
      queue.run(task),
      queue.run(task),
    ]);

    expect(maxRunningObserved).toBeLessThanOrEqual(2);
    expect(queue.runningCount).toBe(0);
    expect(queue.pendingCount).toBe(0);
  });
});
