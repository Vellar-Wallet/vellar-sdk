import { describe, expect, it, vi } from "vitest";
import type { BalanceReader } from "../../../src/balances";
import { readXlmBalance } from "./read-balance";

describe("readXlmBalance", () => {
  const xlm = { symbol: "XLM", contractId: "CNATIVE", decimals: 7 };

  it("returns both raw stroops and formatted XLM", async () => {
    const reader: BalanceReader = {
      getTokenBalance: vi.fn().mockResolvedValue(1_250_000_000n),
    };

    const result = await readXlmBalance(reader, xlm, "GHOLDER");

    expect(result.stroops).toBe(1_250_000_000n);
    expect(result.xlm).toBe("125");
    expect(reader.getTokenBalance).toHaveBeenCalledWith("CNATIVE", "GHOLDER");
  });

  it("propagates reader failures", async () => {
    const reader: BalanceReader = {
      getTokenBalance: vi.fn().mockRejectedValue(new Error("rpc unreachable")),
    };
    await expect(readXlmBalance(reader, xlm, "GHOLDER")).rejects.toThrow("rpc unreachable");
  });
});
