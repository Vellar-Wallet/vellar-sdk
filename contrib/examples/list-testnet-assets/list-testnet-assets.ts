// Example: print a fixed list of common testnet asset codes useful for
// manual testing. This is a static reference list, NOT a live query — the
// SDK has no "list assets" endpoint, and testnet issuers/liquidity change
// over time, so verify an asset still exists before relying on it.
//
// Run with: npx tsx list-testnet-assets.ts

export interface TestnetAsset {
  code: string;
  description: string;
}

export const TESTNET_ASSETS: TestnetAsset[] = [
  { code: "XLM", description: "Native Stellar Lumens — no issuer, always available" },
  { code: "USDC", description: "Circle's testnet USD Coin, widely used for payment demos" },
  { code: "yUSDC", description: "Yield-bearing wrapped testnet USDC used in some DeFi demos" },
  { code: "SRT", description: "Common StellarX testnet reward/test token" },
  { code: "TEST", description: "Generic placeholder code many sample issuers mint for demos" },
  { code: "BTC", description: "Testnet-issued synthetic Bitcoin-pegged asset used in anchor demos" },
];

function printTable(assets: TestnetAsset[]): void {
  const codeWidth = Math.max(...assets.map((a) => a.code.length), "CODE".length);
  const header = `${"CODE".padEnd(codeWidth)}  DESCRIPTION`;
  console.log(header);
  console.log("-".repeat(header.length));
  for (const asset of assets) {
    console.log(`${asset.code.padEnd(codeWidth)}  ${asset.description}`);
  }
}

function main() {
  printTable(TESTNET_ASSETS);
  console.log();
  console.log("Static reference list — not a live query. Verify an asset/issuer still exists on testnet before use.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
