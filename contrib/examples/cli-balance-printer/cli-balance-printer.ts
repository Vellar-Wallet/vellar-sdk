// Example: a command-line tool that prints an aligned table of balances for
// one account across one or more token contracts. It reads through the SDK's
// own createBalanceService, but wired to an in-memory mock BalanceReader, so
// it runs end to end with no live network call.
//
// Run with:
//   node --experimental-strip-types cli-balance-printer.ts <accountId> <tokenContractId...>

import { pathToFileURL } from "node:url";
import {
  createBalanceService,
  formatTokenAmount,
  type BalanceReader,
  type TokenBalance,
  type TokenInfo,
} from "../../../src/balances";

/** The token contracts the mock ledger knows about. Contract ids are obviously
 * fake — this tool never touches a real network. */
const MOCK_TOKENS: Record<string, TokenInfo> = {
  CUSDCMOCKCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX: {
    symbol: "USDC",
    contractId: "CUSDCMOCKCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    decimals: 7,
  },
  CXLMMOCKCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX: {
    symbol: "XLM",
    contractId: "CXLMMOCKCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    decimals: 7,
  },
  CEURCMOCKCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX: {
    symbol: "EURC",
    contractId: "CEURCMOCKCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    decimals: 6,
  },
};

/** Raw balances the mock reader serves, keyed by `${contractId}:${holder}`.
 * A holder with no entry reads as zero, which is what a real token contract
 * returns for an address that has never held the asset. */
const MOCK_LEDGER: Record<string, bigint> = {
  "CUSDCMOCKCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX:CMOCKACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX":
    1_250_5000000n,
  "CXLMMOCKCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX:CMOCKACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX":
    42_0000000n,
  "CEURCMOCKCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX:CMOCKACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX":
    18_750000n,
};

export interface CliArgs {
  accountId: string;
  tokenContractIds: string[];
}

/**
 * Parses `<accountId> <tokenContractId...>`. Repeated contract ids are
 * collapsed (first occurrence wins) so the table never shows the same token
 * twice, and both the account id and at least one token are required.
 */
export function parseArgs(argv: string[]): CliArgs {
  const positional = argv.filter((arg) => arg.trim() !== "");
  const [accountId, ...tokenContractIds] = positional;

  if (!accountId) {
    throw new Error("Missing <accountId>. Usage: <accountId> <tokenContractId...>");
  }
  if (tokenContractIds.length === 0) {
    throw new Error("At least one <tokenContractId> is required");
  }

  return { accountId, tokenContractIds: [...new Set(tokenContractIds)] };
}

/**
 * A BalanceReader backed by MOCK_LEDGER. Unknown token contracts are rejected
 * — a real token read against a non-token address fails too — while an unknown
 * holder simply reads as zero.
 */
export function createMockBalanceReader(): BalanceReader {
  return {
    async getTokenBalance(tokenContractId: string, holder: string): Promise<bigint> {
      if (!MOCK_TOKENS[tokenContractId]) {
        throw new Error(`Unknown token contract ${tokenContractId}`);
      }
      return MOCK_LEDGER[`${tokenContractId}:${holder}`] ?? 0n;
    },
  };
}

/** Resolves contract ids to the TokenInfo the balance service needs, failing
 * with the full list of known ids rather than a bare "not found". */
export function resolveTokens(tokenContractIds: string[]): TokenInfo[] {
  return tokenContractIds.map((contractId) => {
    const token = MOCK_TOKENS[contractId];
    if (!token) {
      throw new Error(
        `Unknown token contract "${contractId}". Known contracts:\n  ${Object.keys(MOCK_TOKENS).join("\n  ")}`,
      );
    }
    return token;
  });
}

/** Renders balances as an aligned text table: symbol and contract id left
 * aligned, the formatted amount right aligned so decimal points line up. */
export function formatBalanceTable(accountId: string, balances: TokenBalance[]): string {
  const rows = balances.map((balance) => ({
    token: balance.symbol,
    contract: balance.contractId,
    amount: formatTokenAmount(balance.amount, balance.decimals),
  }));

  const headers = { token: "TOKEN", contract: "CONTRACT", amount: "BALANCE" };
  const width = (key: keyof typeof headers) =>
    Math.max(headers[key].length, ...rows.map((row) => row[key].length));
  const tokenWidth = width("token");
  const contractWidth = width("contract");
  const amountWidth = width("amount");

  const line = (row: typeof headers) =>
    `${row.token.padEnd(tokenWidth)}  ${row.contract.padEnd(contractWidth)}  ${row.amount.padStart(amountWidth)}`;

  return [
    `Account: ${accountId}`,
    "",
    line(headers),
    "-".repeat(line(headers).length),
    ...rows.map(line),
  ].join("\n");
}

/**
 * Runs one CLI invocation: resolve the tokens, read every balance through the
 * SDK's balance service, and return the rendered table. Separated from `main`
 * so it is directly testable without touching `process.argv`.
 */
export async function printBalances(
  args: CliArgs,
  reader: BalanceReader = createMockBalanceReader(),
): Promise<string> {
  const tokens = resolveTokens(args.tokenContractIds);
  const balances = await createBalanceService(reader, tokens).getBalances(args.accountId);
  return formatBalanceTable(args.accountId, balances);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(await printBalances(args));
}

// pathToFileURL rather than a `file://` template so the entrypoint check also
// holds on Windows, where argv[1] is a drive-letter path.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`Error: ${(err as Error).message}`);
    process.exitCode = 1;
  });
}
