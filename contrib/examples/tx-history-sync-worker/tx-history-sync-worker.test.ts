import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyState, createSyncWorker, mergeBatch, type SyncedTransaction } from "./tx-history-sync-worker";

describe("mergeBatch", () => {
  it("appends every transaction from an all-new batch", () => {
    const state = createEmptyState();
    const newCount = mergeBatch(state, [{ id: "tx-1", amount: "10" }, { id: "tx-2", amount: "20" }]);

    expect(newCount).toBe(2);
    expect(state.history).toEqual([{ id: "tx-1", amount: "10" }, { id: "tx-2", amount: "20" }]);
  });

  it("skips ids already seen in a previous merge, keeping only the new ones", () => {
    const state = createEmptyState();
    mergeBatch(state, [{ id: "tx-1", amount: "10" }, { id: "tx-2", amount: "20" }]);
    const newCount = mergeBatch(state, [{ id: "tx-2", amount: "20" }, { id: "tx-3", amount: "30" }]);

    expect(newCount).toBe(1);
    expect(state.history.map((tx) => tx.id)).toEqual(["tx-1", "tx-2", "tx-3"]);
  });

  it("handles a fully overlapping batch as zero new", () => {
    const state = createEmptyState();
    mergeBatch(state, [{ id: "tx-1", amount: "10" }]);
    const newCount = mergeBatch(state, [{ id: "tx-1", amount: "10" }]);

    expect(newCount).toBe(0);
    expect(state.history).toHaveLength(1);
  });

  it("processes three overlapping polls into a fully deduplicated history", () => {
    const state = createEmptyState();
    mergeBatch(state, [{ id: "tx-1", amount: "10" }, { id: "tx-2", amount: "20" }]);
    mergeBatch(state, [{ id: "tx-2", amount: "20" }, { id: "tx-3", amount: "30" }]);
    mergeBatch(state, [{ id: "tx-3", amount: "30" }, { id: "tx-4", amount: "40" }, { id: "tx-5", amount: "50" }]);

    expect(state.history.map((tx) => tx.id)).toEqual(["tx-1", "tx-2", "tx-3", "tx-4", "tx-5"]);
  });
});

describe("createSyncWorker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls immediately on start and reports history/lastSeenId", async () => {
    const source = vi.fn<() => SyncedTransaction[]>().mockReturnValue([{ id: "tx-1", amount: "10" }]);
    const worker = createSyncWorker(source, 1000);

    worker.start();
    await vi.waitFor(() => expect(source).toHaveBeenCalledTimes(1));

    expect(worker.history()).toEqual([{ id: "tx-1", amount: "10" }]);
    expect(worker.lastSeenId()).toBe("tx-1");
    worker.stop();
  });

  it("polls again after the interval elapses", async () => {
    const source = vi
      .fn<() => SyncedTransaction[]>()
      .mockReturnValueOnce([{ id: "tx-1", amount: "10" }])
      .mockReturnValueOnce([{ id: "tx-1", amount: "10" }, { id: "tx-2", amount: "20" }]);
    const worker = createSyncWorker(source, 1000);

    worker.start();
    await vi.waitFor(() => expect(source).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(source).toHaveBeenCalledTimes(2));

    expect(worker.history().map((tx) => tx.id)).toEqual(["tx-1", "tx-2"]);
    worker.stop();
  });

  it("stops polling after stop() is called", async () => {
    const source = vi.fn<() => SyncedTransaction[]>().mockReturnValue([{ id: "tx-1", amount: "10" }]);
    const worker = createSyncWorker(source, 1000);

    worker.start();
    await vi.waitFor(() => expect(source).toHaveBeenCalledTimes(1));
    worker.stop();

    await vi.advanceTimersByTimeAsync(5000);
    expect(source).toHaveBeenCalledTimes(1);
  });

  it("calling start() twice does not double the polling interval", async () => {
    const source = vi.fn<() => SyncedTransaction[]>().mockReturnValue([]);
    const worker = createSyncWorker(source, 1000);

    worker.start();
    await vi.waitFor(() => expect(source).toHaveBeenCalledTimes(1));
    worker.start(); // no-op, already running

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(source).toHaveBeenCalledTimes(2));
    worker.stop();
  });
});
