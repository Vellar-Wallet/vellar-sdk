// Example: read a native XLM balance for a given account using the SDK's
// RPC-backed balance reader, and print both the raw stroops amount and the
// formatted XLM amount.
//
// Run with: npx tsx read-balance.ts <accountId>
// Example:  npx tsx read-balance.ts GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H

import { formatTokenAmount, type BalanceReader, type TokenInfo } from "../../../src/balances";
import { createRpcBalanceReader, nativeToken } from "../../../src/rpc";
import { TESTNET } from "../../../src/config";

export interface XlmBalanceResult {
  stroops: bigint;
  xlm: string;
}

/** Reads and formats one account's native balance. Reader/token are injected
 * so this is directly unit-testable without a real RPC round trip. */
export async function readXlmBalance(
  reader: BalanceReader,
  token: TokenInfo,
  accountId: string,
): Promise<XlmBalanceResult> {
  const stroops = await reader.getTokenBalance(token.contractId, accountId);
  return { stroops, xlm: formatTokenAmount(stroops, token.decimals) };
}

async function main() {
  const accountId = process.argv[2];
  if (!accountId) {
    console.error("Usage: npx tsx read-balance.ts <accountId>");
    process.exitCode = 1;
    return;
  }

  const reader = createRpcBalanceReader({
    rpcUrl: TESTNET.rpcUrl,
    networkPassphrase: TESTNET.networkPassphrase,
  });
  const token = nativeToken(TESTNET.networkPassphrase);

  try {
    const { stroops, xlm } = await readXlmBalance(reader, token, accountId);
    console.log(`Account:  ${accountId}`);
    console.log(`Balance:  ${stroops} stroops (${xlm} XLM)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error reading balance: ${message}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
