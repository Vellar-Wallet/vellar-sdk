import { describe, expect, it, vi } from "vitest";
import { createBalanceService, formatTokenAmount, type BalanceReader } from "./balances";

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
