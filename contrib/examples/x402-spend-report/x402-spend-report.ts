// Example: generate a spend report from a list of completed x402
// settlements (vellar-sdk's X402Settlement shape, src/x402-types.ts),
// grouped by asset with per-asset totals and an overall settlement count.
//
// Run with: npx tsx x402-spend-report.ts

import type { X402Settlement } from "../../../src/x402-types";

export interface AssetTotal {
  asset: string;
  totalAmount: bigint;
  settlementCount: number;
}

export interface SpendReport {
  totalSettlements: number;
  byAsset: AssetTotal[];
}

/** Groups settlements by asset, summing amounts per group. byAsset is
 * sorted alphabetically by asset for a stable, readable report. */
export function generateSpendReport(settlements: X402Settlement[]): SpendReport {
  const totals = new Map<string, AssetTotal>();

  for (const settlement of settlements) {
    const existing = totals.get(settlement.asset);
    if (existing) {
      existing.totalAmount += settlement.amount;
      existing.settlementCount++;
    } else {
      totals.set(settlement.asset, {
        asset: settlement.asset,
        totalAmount: settlement.amount,
        settlementCount: 1,
      });
    }
  }

  return {
    totalSettlements: settlements.length,
    byAsset: [...totals.values()].sort((a, b) => a.asset.localeCompare(b.asset)),
  };
}

function formatReport(report: SpendReport): string {
  const lines = [`Total settlements: ${report.totalSettlements}`, ""];
  for (const group of report.byAsset) {
    lines.push(`${group.asset}: ${group.totalAmount} (${group.settlementCount} settlement${group.settlementCount === 1 ? "" : "s"})`);
  }
  return lines.join("\n");
}

function main() {
  const sampleSettlements: X402Settlement[] = [
    { transaction: "tx1", payer: "CAGENT1", asset: "CUSDC", amount: 2_500_000n, network: "testnet" },
    { transaction: "tx2", payer: "CAGENT1", asset: "CUSDC", amount: 1_000_000n, network: "testnet" },
    { transaction: "tx3", payer: "CAGENT2", asset: "CNATIVE", amount: 50_000_000n, network: "testnet" },
    { transaction: "tx4", payer: "CAGENT1", asset: "CAQUA", amount: 750_000n, network: "testnet" },
  ];

  const report = generateSpendReport(sampleSettlements);
  console.log(formatReport(report));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
