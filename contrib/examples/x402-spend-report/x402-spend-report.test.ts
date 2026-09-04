import { describe, expect, it } from "vitest";
import type { X402Settlement } from "../../../src/x402-types";
import { generateSpendReport } from "./x402-spend-report";

const settlement = (overrides: Partial<X402Settlement>): X402Settlement => ({
  transaction: "tx",
  payer: "CPAYER",
  asset: "CUSDC",
  amount: 0n,
  network: "testnet",
  ...overrides,
});

describe("generateSpendReport", () => {
  it("sums amounts within the same asset group", () => {
    const report = generateSpendReport([
      settlement({ asset: "CUSDC", amount: 100n }),
      settlement({ asset: "CUSDC", amount: 250n }),
    ]);
    expect(report.byAsset).toEqual([{ asset: "CUSDC", totalAmount: 350n, settlementCount: 2 }]);
  });

  it("reports the overall settlement count alongside per-asset breakdown", () => {
    const report = generateSpendReport([
      settlement({ asset: "CUSDC", amount: 100n }),
      settlement({ asset: "CNATIVE", amount: 200n }),
      settlement({ asset: "CNATIVE", amount: 300n }),
    ]);
    expect(report.totalSettlements).toBe(3);
    expect(report.byAsset).toHaveLength(2);
  });

  it("sorts the asset breakdown alphabetically", () => {
    const report = generateSpendReport([
      settlement({ asset: "CZ", amount: 1n }),
      settlement({ asset: "CA", amount: 1n }),
      settlement({ asset: "CM", amount: 1n }),
    ]);
    expect(report.byAsset.map((g) => g.asset)).toEqual(["CA", "CM", "CZ"]);
  });

  it("returns an empty report for an empty settlement list", () => {
    expect(generateSpendReport([])).toEqual({ totalSettlements: 0, byAsset: [] });
  });
});
