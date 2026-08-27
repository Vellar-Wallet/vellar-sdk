import { describe, expect, it, vi } from "vitest";
import {
  createBalanceService,
  createNegativeCachingBalanceReader,
  formatTokenAmount,
  type BalanceReader,
} from "./balances";

describe("formatTokenAmount", () => {
  it.each([
    [0n, 7, "0"],
    [100000000000n, 7, "10000"],
    [10000001n, 7, "1.0000001"],
    [1n, 7, "0.0000001"],
    [12345000n, 7, "1.2345"],
    [-25000000n, 7, "-2.5"],
    [42n, 0, "42"],
  ])("formats %s with %s decimals as %s", (amount, decimals, expected) => {
    expect(formatTokenAmount(amount, decimals)).toBe(expected);
  });

  it("rejects invalid decimals", () => {
    expect(() => formatTokenAmount(1n, -1)).toThrow(RangeError);
    expect(() => formatTokenAmount(1n, 1.5)).toThrow(RangeError);
  });
});

describe("createBalanceService", () => {
  const xlm = { symbol: "XLM", contractId: "CNATIVE", decimals: 7 };
  const usdc = { symbol: "USDC", contractId: "CUSDC", decimals: 7 };

  it("reads every configured token for the holder", async () => {
    const reader: BalanceReader = {
      getTokenBalance: vi
        .fn()
        .mockImplementation(async (contractId: string) => (contractId === "CNATIVE" ? 5n : 7n)),
    };
    const service = createBalanceService(reader, [xlm, usdc]);

    await expect(service.getBalances("CHOLDER")).resolves.toEqual([
      { ...xlm, amount: 5n },
      { ...usdc, amount: 7n },
    ]);
    expect(reader.getTokenBalance).toHaveBeenCalledWith("CNATIVE", "CHOLDER");
    expect(reader.getTokenBalance).toHaveBeenCalledWith("CUSDC", "CHOLDER");
  });

  it("propagates reader failures", async () => {
    const reader: BalanceReader = {
      getTokenBalance: vi.fn().mockRejectedValue(new Error("rpc down")),
    };
    await expect(createBalanceService(reader, [xlm]).getBalances("CHOLDER")).rejects.toThrow(
      "rpc down",
    );
  });

  it("returns an empty list when no tokens are configured", async () => {
    const reader: BalanceReader = { getTokenBalance: vi.fn() };
    await expect(createBalanceService(reader, []).getBalances("CHOLDER")).resolves.toEqual([]);
    expect(reader.getTokenBalance).not.toHaveBeenCalled();
  });
});

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
