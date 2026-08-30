// Example: resolve a batch of {account, token} balance lookups concurrently,
// returning a same-length array of per-item results in order. One failing
// lookup does not prevent the others from resolving.
//
// Run with: npx tsx batch-balance-lookup.ts

import type { BalanceReader, TokenInfo } from "../../../src/balances";

export interface BalanceLookup {
  account: string;
  token: TokenInfo;
}

export type BalanceLookupResult =
  | { account: string; token: TokenInfo; ok: true; amount: bigint }
  | { account: string; token: TokenInfo; ok: false; error: string };

/**
 * Resolves every lookup concurrently via Promise.allSettled, so a single
 * rejected lookup is reported per-item rather than rejecting the whole
 * batch or blocking the others.
 */
export async function batchLookupBalances(
  reader: BalanceReader,
  lookups: BalanceLookup[],
): Promise<BalanceLookupResult[]> {
  const settled = await Promise.allSettled(
    lookups.map((lookup) => reader.getTokenBalance(lookup.token.contractId, lookup.account)),
  );

  return settled.map((result, i) => {
    const { account, token } = lookups[i]!;
    if (result.status === "fulfilled") {
      return { account, token, ok: true, amount: result.value };
    }
    const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
    return { account, token, ok: false, error };
  });
}

async function main() {
  const xlm: TokenInfo = { symbol: "XLM", contractId: "CNATIVE", decimals: 7 };
  const usdc: TokenInfo = { symbol: "USDC", contractId: "CUSDC", decimals: 7 };

  // A mock reader: fails only for the CUSDC lookup, to demonstrate that one
  // failure doesn't block the others.
  const reader: BalanceReader = {
    async getTokenBalance(tokenContractId, holder) {
      if (tokenContractId === "CUSDC") {
        throw new Error(`simulation failed for ${holder}`);
      }
      return 500_000_000n;
    },
  };

  const results = await batchLookupBalances(reader, [
    { account: "GALICE", token: xlm },
    { account: "GBOB", token: usdc },
    { account: "GCAROL", token: xlm },
  ]);

  for (const result of results) {
    if (result.ok) {
      console.log(`${result.account} (${result.token.symbol}): ${result.amount}`);
    } else {
      console.log(`${result.account} (${result.token.symbol}): FAILED — ${result.error}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
