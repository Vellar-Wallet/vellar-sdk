import { describe, expect, it, vi } from "vitest";
import {
  createCachedBalanceReader,
  warmUpBalanceCache,
  type BalanceReader,
} from "./balance-cache-warmup";

describe("createCachedBalanceReader", () => {
  const TTL_MS = 60_000;

  function countingReader(amount = 100n) {
    let calls = 0;
    const reader: BalanceReader = {
      getTokenBalance: vi.fn(async () => {
        calls += 1;
        return amount;
      }),
    };
    return { reader, getCalls: () => calls };
  }

  it("serves a cache hit within the TTL without calling the underlying reader again", async () => {
    let now = 1_000_000;
    const { reader, getCalls } = countingReader(42n);
    const cached = createCachedBalanceReader(reader, { ttlMs: TTL_MS, now: () => now });

    expect(await cached.getTokenBalance("CTOKEN", "CHOLDER")).toBe(42n);
    now += 1000; // well within the 60s TTL
    expect(await cached.getTokenBalance("CTOKEN", "CHOLDER")).toBe(42n);
    expect(getCalls()).toBe(1);
  });

  it("re-reads once the TTL has elapsed", async () => {
    let now = 1_000_000;
    const { reader, getCalls } = countingReader();
    const cached = createCachedBalanceReader(reader, { ttlMs: TTL_MS, now: () => now });

    await cached.getTokenBalance("CTOKEN", "CHOLDER");
    now += TTL_MS + 1;
    await cached.getTokenBalance("CTOKEN", "CHOLDER");
    expect(getCalls()).toBe(2);
  });

  it("caches each (tokenContractId, holder) pair independently", async () => {
    const { reader, getCalls } = countingReader();
    const cached = createCachedBalanceReader(reader, { ttlMs: TTL_MS });

    await cached.getTokenBalance("CTOKEN_A", "CHOLDER_1");
    await cached.getTokenBalance("CTOKEN_B", "CHOLDER_1");
    await cached.getTokenBalance("CTOKEN_A", "CHOLDER_2");
    expect(getCalls()).toBe(3);

    await cached.getTokenBalance("CTOKEN_A", "CHOLDER_1");
    expect(getCalls()).toBe(3); // still cached
  });

  it("never caches a failed read — the next call retries", async () => {
    let shouldFail = true;
    const reader: BalanceReader = {
      getTokenBalance: vi.fn(async () => {
        if (shouldFail) throw new Error("rpc down");
        return 7n;
      }),
    };
    const cached = createCachedBalanceReader(reader, { ttlMs: TTL_MS });

    await expect(cached.getTokenBalance("CTOKEN", "CHOLDER")).rejects.toThrow("rpc down");
    shouldFail = false;
    await expect(cached.getTokenBalance("CTOKEN", "CHOLDER")).resolves.toBe(7n);
  });

  it("prime() seeds the cache without calling the underlying reader", async () => {
    const { reader, getCalls } = countingReader();
    const cached = createCachedBalanceReader(reader, { ttlMs: TTL_MS });

    cached.prime("CTOKEN", "CHOLDER", 999n);
    expect(await cached.getTokenBalance("CTOKEN", "CHOLDER")).toBe(999n);
    expect(getCalls()).toBe(0);
  });

  it("invalidate() with no arguments clears every cached entry", async () => {
    const { reader, getCalls } = countingReader();
    const cached = createCachedBalanceReader(reader, { ttlMs: TTL_MS });

    await cached.getTokenBalance("CTOKEN_A", "CHOLDER");
    await cached.getTokenBalance("CTOKEN_B", "CHOLDER");
    cached.invalidate();
    await cached.getTokenBalance("CTOKEN_A", "CHOLDER");
    await cached.getTokenBalance("CTOKEN_B", "CHOLDER");
    expect(getCalls()).toBe(4);
  });

  it("invalidate(tokenContractId) clears only that token, across all holders", async () => {
    const { reader, getCalls } = countingReader();
    const cached = createCachedBalanceReader(reader, { ttlMs: TTL_MS });

    await cached.getTokenBalance("CTOKEN_A", "CHOLDER_1");
    await cached.getTokenBalance("CTOKEN_A", "CHOLDER_2");
    await cached.getTokenBalance("CTOKEN_B", "CHOLDER_1");
    cached.invalidate("CTOKEN_A");

    await cached.getTokenBalance("CTOKEN_A", "CHOLDER_1"); // re-read
    await cached.getTokenBalance("CTOKEN_A", "CHOLDER_2"); // re-read
    await cached.getTokenBalance("CTOKEN_B", "CHOLDER_1"); // still cached
    expect(getCalls()).toBe(5);
  });

  it("invalidate(tokenContractId, holder) clears exactly one entry", async () => {
    const { reader, getCalls } = countingReader();
    const cached = createCachedBalanceReader(reader, { ttlMs: TTL_MS });

    await cached.getTokenBalance("CTOKEN", "CHOLDER_1");
    await cached.getTokenBalance("CTOKEN", "CHOLDER_2");
    cached.invalidate("CTOKEN", "CHOLDER_1");

    await cached.getTokenBalance("CTOKEN", "CHOLDER_1"); // re-read
    await cached.getTokenBalance("CTOKEN", "CHOLDER_2"); // still cached
    expect(getCalls()).toBe(3);
  });
});

describe("warmUpBalanceCache", () => {
  const xlm = { symbol: "XLM", contractId: "CNATIVE", decimals: 7 };
  const usdc = { symbol: "USDC", contractId: "CUSDC", decimals: 7 };

  it("populates the cache for every configured token", async () => {
    const reader: BalanceReader = {
      getTokenBalance: vi
        .fn()
        .mockImplementation(async (contractId: string) => (contractId === "CNATIVE" ? 5n : 7n)),
    };
    const cached = createCachedBalanceReader(reader, { ttlMs: 60_000 });

    const result = await warmUpBalanceCache(cached, "CHOLDER", { tokens: [xlm, usdc] });

    expect(result).toEqual({ warmed: ["CNATIVE", "CUSDC"], failed: [] });
    expect(await cached.getTokenBalance("CNATIVE", "CHOLDER")).toBe(5n);
    expect(await cached.getTokenBalance("CUSDC", "CHOLDER")).toBe(7n);
    expect(reader.getTokenBalance).toHaveBeenCalledTimes(2);
  });

  it("warms up only the configured subset, not every possible token", async () => {
    const reader: BalanceReader = { getTokenBalance: vi.fn().mockResolvedValue(1n) };
    const cached = createCachedBalanceReader(reader, { ttlMs: 60_000 });

    await warmUpBalanceCache(cached, "CHOLDER", { tokens: [xlm] });

    expect(reader.getTokenBalance).toHaveBeenCalledTimes(1);
    expect(reader.getTokenBalance).toHaveBeenCalledWith("CNATIVE", "CHOLDER");
  });

  it("continues warming up remaining tokens after one fails (default continueOnError)", async () => {
    const reader: BalanceReader = {
      getTokenBalance: vi.fn().mockImplementation(async (contractId: string) => {
        if (contractId === "CNATIVE") throw new Error("rpc down");
        return 7n;
      }),
    };
    const cached = createCachedBalanceReader(reader, { ttlMs: 60_000 });

    const result = await warmUpBalanceCache(cached, "CHOLDER", { tokens: [xlm, usdc] });

    expect(result.warmed).toEqual(["CUSDC"]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.contractId).toBe("CNATIVE");
    expect(result.failed[0]?.error).toBeInstanceOf(Error);
  });

  it("aborts on the first failure when continueOnError is false", async () => {
    const reader: BalanceReader = {
      getTokenBalance: vi.fn().mockRejectedValue(new Error("rpc down")),
    };
    const cached = createCachedBalanceReader(reader, { ttlMs: 60_000 });

    await expect(
      warmUpBalanceCache(cached, "CHOLDER", { tokens: [xlm], continueOnError: false }),
    ).rejects.toThrow("rpc down");
  });

  it("returns empty warmed/failed when given no tokens", async () => {
    const reader: BalanceReader = { getTokenBalance: vi.fn() };
    const cached = createCachedBalanceReader(reader, { ttlMs: 60_000 });

    const result = await warmUpBalanceCache(cached, "CHOLDER", { tokens: [] });
    expect(result).toEqual({ warmed: [], failed: [] });
    expect(reader.getTokenBalance).not.toHaveBeenCalled();
  });
});
