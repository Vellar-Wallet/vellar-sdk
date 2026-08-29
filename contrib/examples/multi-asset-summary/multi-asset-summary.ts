// Example: format a readable summary line per asset from a sample array of
// balances across several assets, sorted alphabetically by asset code.
//
// Run with: npx tsx multi-asset-summary.ts

import { formatTokenAmount, type TokenBalance } from "../../../src/balances";

/** Formats a "SYMBOL: amount" line per asset, sorted alphabetically by
 * symbol. An empty array prints a clear "No balances." message. */
export function formatMultiAssetSummary(balances: TokenBalance[]): string {
  if (balances.length === 0) {
    return "No balances.";
  }

  const sorted = [...balances].sort((a, b) => a.symbol.localeCompare(b.symbol));
  return sorted.map((b) => `${b.symbol}: ${formatTokenAmount(b.amount, b.decimals)}`).join("\n");
}

function main() {
  const sampleBalances: TokenBalance[] = [
    { symbol: "USDC", contractId: "CUSDC", decimals: 7, amount: 250_000_0000n },
    { symbol: "XLM", contractId: "CNATIVE", decimals: 7, amount: 1_000_000_0000n },
    { symbol: "AQUA", contractId: "CAQUA", decimals: 7, amount: 50_000_0000000n },
  ];

  console.log("With balances:");
  console.log(formatMultiAssetSummary(sampleBalances));
  console.log();
  console.log("With no balances:");
  console.log(formatMultiAssetSummary([]));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
