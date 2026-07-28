// Example: check a given network passphrase string against the known
// testnet/mainnet passphrases, returning which network it matches (or null
// if unknown). Comparison is case-sensitive and exact — a passphrase with
// different casing or extra whitespace does NOT match.
//
// Run with: npx tsx validate-passphrase.ts

import { MAINNET, TESTNET } from "../../../src/config";

export type NetworkMatch = "testnet" | "mainnet" | null;

/** Exact, case-sensitive match against TESTNET/MAINNET.networkPassphrase.
 * Returns null for anything else, including a passphrase that only differs
 * by case or surrounding whitespace. */
export function matchNetworkPassphrase(passphrase: string): NetworkMatch {
  if (passphrase === TESTNET.networkPassphrase) return "testnet";
  if (passphrase === MAINNET.networkPassphrase) return "mainnet";
  return null;
}

function main() {
  const examples = [
    TESTNET.networkPassphrase,
    MAINNET.networkPassphrase,
    "Not a real passphrase",
    TESTNET.networkPassphrase.toLowerCase(), // wrong case — does not match
  ];

  for (const passphrase of examples) {
    console.log(`"${passphrase}" -> ${matchNetworkPassphrase(passphrase) ?? "unknown"}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
