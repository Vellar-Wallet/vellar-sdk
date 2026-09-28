import { Command } from "commander";
import {
  createBalanceService,
  fetchBalancesBatch,
  formatTokenAmount,
  MAX_BATCH_BALANCE_SIZE,
  TESTNET,
  MAINNET,
  type TokenInfo,
} from "vellar-sdk";
import { createRpcBalanceReader } from "vellar-sdk/rpc";

const NETWORKS = { testnet: TESTNET, mainnet: MAINNET } as const;

type BalanceOptions = {
  network: keyof typeof NETWORKS;
  token?: string[];
  json?: boolean;
};

function tokensFor(options: BalanceOptions): TokenInfo[] {
  const network = NETWORKS[options.network];
  if (!options.token || options.token.length === 0) {
    return [
      { symbol: "XLM", contractId: network.nativeTokenContractId, decimals: 7 },
      { symbol: "USDC", contractId: network.usdcContractId, decimals: 7 },
    ];
  }

  return options.token.map((contractId, index) => ({
    symbol: `TOKEN_${index + 1}`,
    contractId,
    // Stellar token decimals are not discoverable from a balance read alone.
    // Seven is the network-native display precision; JSON always includes raw units.
    decimals: 7,
  }));
}

export function makeBalanceCommand(): Command {
  return new Command("balance")
    .description("Read token balances for a wallet or account")
    .argument("<address>", "Wallet or account address")
    .option("--network <network>", "testnet or mainnet", "testnet")
    .option("--token <contract-id...>", "Token contract IDs; defaults to XLM and USDC")
    .option("--json", "Output machine-readable JSON")
    .action(async (address: string, opts: BalanceOptions) => {
      try {
        const network = NETWORKS[opts.network];
        if (!network) {
          console.error(`Error: --network must be 'testnet' or 'mainnet', got '${opts.network}'`);
          process.exit(1);
          return;
        }

        const tokens = tokensFor(opts);
        if (tokens.length > MAX_BATCH_BALANCE_SIZE) {
          console.error(
            `Error: requested ${tokens.length} tokens, but one balance batch supports at most ${MAX_BATCH_BALANCE_SIZE}.`,
          );
          process.exit(1);
          return;
        }

        const reader = createRpcBalanceReader({
          rpcUrl: network.rpcUrl,
          networkPassphrase: network.networkPassphrase,
        });
        const results = opts.token
          ? await fetchBalancesBatch(reader, address, tokens)
          : await createBalanceService(reader, tokens).getBalancesBatch(address, tokens);
        const output = results.map((result, index) => {
          const token = tokens[index];
          if (!token || !result.success) {
            return result;
          }
          return {
            symbol: token.symbol,
            contractId: result.contractId,
            amount: result.amount.toString(),
            formatted: formatTokenAmount(result.amount, token.decimals),
          };
        });

        if (opts.json) {
          console.log(JSON.stringify({ address, network: opts.network, balances: output }));
          return;
        }

        console.log(`Balances for ${address} (${opts.network})`);
        for (const item of output) {
          if ("error" in item) {
            console.log(`${item.contractId}: unavailable (${item.error})`);
          } else {
            console.log(`${item.symbol} (${item.contractId}): ${item.formatted}`);
          }
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}