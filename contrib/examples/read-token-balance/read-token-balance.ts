// Example: read a SEP-41 token balance for a given account and token
// contract id, using the SDK's RPC-backed balance reader. Prints the
// balance in raw base units (unlike read-xlm-balance, this does not assume
// 7 decimals — it just prints the raw bigint the contract returns).
//
// Run with: npx tsx read-token-balance.ts <accountId> <tokenContractId>

import type { BalanceReader } from "../../../src/balances";
import { createRpcBalanceReader } from "../../../src/rpc";
import { TESTNET } from "../../../src/config";

/** Reads one token balance. Reader is injected so this is directly
 * unit-testable without a real RPC round trip. */
export async function readTokenBalance(
  reader: BalanceReader,
  tokenContractId: string,
  accountId: string,
): Promise<bigint> {
  return reader.getTokenBalance(tokenContractId, accountId);
}

async function main() {
  const [accountId, tokenContractId] = process.argv.slice(2);
  if (!accountId || !tokenContractId) {
    console.error("Usage: npx tsx read-token-balance.ts <accountId> <tokenContractId>");
    process.exitCode = 1;
    return;
  }

  const reader = createRpcBalanceReader({
    rpcUrl: TESTNET.rpcUrl,
    networkPassphrase: TESTNET.networkPassphrase,
  });

  try {
    const balance = await readTokenBalance(reader, tokenContractId, accountId);
    console.log(`Account:  ${accountId}`);
    console.log(`Token:    ${tokenContractId}`);
    console.log(`Balance:  ${balance} (raw base units)`);
  } catch (err) {
    console.error(`Error reading balance: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
