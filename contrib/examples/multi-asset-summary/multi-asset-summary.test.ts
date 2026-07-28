import { describe, expect, it } from "vitest";
import type { TokenBalance } from "../../../src/balances";
import { formatMultiAssetSummary } from "./multi-asset-summary";

describe("formatMultiAssetSummary", () => {
  it("prints a clear message for an empty array", () => {
    expect(formatMultiAssetSummary([])).toBe("No balances.");
  });

  it("formats one line per asset", () => {
    const balances: TokenBalance[] = [
      { symbol: "XLM", contractId: "CNATIVE", decimals: 7, amount: 1_000_000_000n },
    ];
    expect(formatMultiAssetSummary(balances)).toBe("XLM: 100");
  });

  it("sorts the summary alphabetically by asset code", () => {
    const balances: TokenBalance[] = [
      { symbol: "XLM", contractId: "CNATIVE", decimals: 7, amount: 100n },
      { symbol: "AQUA", contractId: "CAQUA", decimals: 7, amount: 200n },
      { symbol: "USDC", contractId: "CUSDC", decimals: 7, amount: 300n },
    ];
    const lines = formatMultiAssetSummary(balances).split("\n");
    expect(lines.map((l) => l.split(":")[0])).toEqual(["AQUA", "USDC", "XLM"]);
  });

  it("does not mutate the input array order", () => {
    const balances: TokenBalance[] = [
      { symbol: "XLM", contractId: "CNATIVE", decimals: 7, amount: 100n },
      { symbol: "AQUA", contractId: "CAQUA", decimals: 7, amount: 200n },
    ];
    formatMultiAssetSummary(balances);
    expect(balances[0]!.symbol).toBe("XLM"); // original order untouched
  });
});
