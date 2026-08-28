import { describe, expect, it } from "vitest";
import type { BalanceReader, TokenInfo } from "../../../src/balances";
import { batchLookupBalances } from "./batch-balance-lookup";

describe("batchLookupBalances", () => {
  const xlm: TokenInfo = { symbol: "XLM", contractId: "CNATIVE", decimals: 7 };
  const usdc: TokenInfo = { symbol: "USDC", contractId: "CUSDC", decimals: 7 };

  it("returns a same-length array of results in input order", async () => {
    const reader: BalanceReader = { getTokenBalance: async () => 100n };
    const results = await batchLookupBalances(reader, [
      { account: "GA", token: xlm },
      { account: "GB", token: usdc },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ account: "GA", token: xlm, ok: true, amount: 100n });
    expect(results[1]).toEqual({ account: "GB", token: usdc, ok: true, amount: 100n });
  });

  it("reports one failing lookup per-item without blocking the others", async () => {
    const reader: BalanceReader = {
      async getTokenBalance(tokenContractId, holder) {
        if (tokenContractId === "CUSDC") throw new Error(`simulation failed for ${holder}`);
        return 250n;
      },
    };

    const results = await batchLookupBalances(reader, [
      { account: "GA", token: xlm },
      { account: "GB", token: usdc },
      { account: "GC", token: xlm },
    ]);

    expect(results[0]).toEqual({ account: "GA", token: xlm, ok: true, amount: 250n });
    expect(results[1]).toEqual({
      account: "GB",
      token: usdc,
      ok: false,
      error: "simulation failed for GB",
    });
    expect(results[2]).toEqual({ account: "GC", token: xlm, ok: true, amount: 250n });
  });

  it("returns an empty array for an empty batch", async () => {
    const reader: BalanceReader = { getTokenBalance: async () => 0n };
    await expect(batchLookupBalances(reader, [])).resolves.toEqual([]);
  });
});
