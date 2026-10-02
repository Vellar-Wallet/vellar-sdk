import { describe, expect, it, vi } from "vitest";
import {
  createNegativeCachingBalanceReader,
  type BalanceReader,
} from "./negative-balance-cache";

describe("createNegativeCachingBalanceReader", () => {
  it("caches not-found results and serves the second lookup from cache", async () => {
    let time = 0;
    const inner: BalanceReader = {
      getTokenBalance: vi.fn().mockRejectedValue(new Error("unknown asset")),
    };
    const reader = createNegativeCachingBalanceReader(inner, {
      negativeCacheTtlMs: 30_000,
      now: () => time,
    });

    await expect(reader.getTokenBalance("CUNKNOWN", "CHOLDER")).rejects.toThrow("unknown asset");
    await expect(reader.getTokenBalance("CUNKNOWN", "CHOLDER")).rejects.toThrow("unknown asset");
    expect(inner.getTokenBalance).toHaveBeenCalledTimes(1);
    expect(reader.negativeCacheHits).toBe(1);
    expect(reader.negativeCacheMisses).toBe(1);
    expect(reader.negativeCacheHitRate()).toBe(0.5);
  });

  it("does not cache successful reads", async () => {
    const inner: BalanceReader = {
      getTokenBalance: vi.fn().mockResolvedValue(42n),
    };
    const reader = createNegativeCachingBalanceReader(inner);

    await expect(reader.getTokenBalance("CTOKEN", "CHOLDER")).resolves.toBe(42n);
    await expect(reader.getTokenBalance("CTOKEN", "CHOLDER")).resolves.toBe(42n);
    expect(inner.getTokenBalance).toHaveBeenCalledTimes(2);
    expect(reader.negativeCacheHits).toBe(0);
  });

  it("expires cached not-found entries after the TTL", async () => {
    let time = 0;
    const inner: BalanceReader = {
      getTokenBalance: vi.fn().mockRejectedValue(new Error("unknown asset")),
    };
    const reader = createNegativeCachingBalanceReader(inner, {
      negativeCacheTtlMs: 1_000,
      now: () => time,
    });

    await expect(reader.getTokenBalance("CUNKNOWN", "CHOLDER")).rejects.toThrow();
    time = 1_500;
    await expect(reader.getTokenBalance("CUNKNOWN", "CHOLDER")).rejects.toThrow();
    expect(inner.getTokenBalance).toHaveBeenCalledTimes(2);
  });
});
