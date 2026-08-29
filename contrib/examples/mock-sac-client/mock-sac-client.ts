// Example: a mock SacClientLike (BalanceReader) returning a fixed balance
// for any token/account pair, configured at construction time — for use in
// offline tests that need a balance reader without a real RPC call.
//
// Run with: npx tsx mock-sac-client.ts

import type { BalanceReader } from "../../../src/balances";

/**
 * A mock BalanceReader: getTokenBalance always resolves with the same
 * fixed balance, regardless of which token contract or holder is asked
 * for — useful as the reader passed to createBalanceService (src/balances.ts)
 * in offline tests.
 */
export function createMockBalanceReader(fixedBalance: bigint): BalanceReader {
  return {
    async getTokenBalance(_tokenContractId: string, _holder: string) {
      return fixedBalance;
    },
  };
}

async function main() {
  const reader = createMockBalanceReader(500_000_000n);

  const accounts = ["GALICE", "GBOB", "CCONTRACTHOLDERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"];
  for (const account of accounts) {
    const balance = await reader.getTokenBalance("CANYTOKENCONTRACT", account);
    console.log(`${account}: ${balance} (fixed, regardless of token or account)`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
