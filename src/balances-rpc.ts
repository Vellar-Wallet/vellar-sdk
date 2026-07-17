import {
  Account,
  Address,
  Asset,
  Operation,
  rpc,
  scValToBigInt,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import type { BalanceReader, TokenInfo } from "./balances";

// RPC-backed BalanceReader: simulates the token contract's `balance(id)`
// read — no signature, no fee, works for contract (C...) and classic (G...)
// holders. Exported via the "@vela/wallet-sdk/rpc" subpath so consumers that
// never read balances don't pull @stellar/stellar-sdk into their bundle.

/** Standard null account used as the simulation source for read-only calls. */
const SIMULATION_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export function nativeToken(networkPassphrase: string): TokenInfo {
  return {
    symbol: "XLM",
    contractId: Asset.native().contractId(networkPassphrase),
    decimals: 7,
  };
}

export interface RpcBalanceReaderOptions {
  rpcUrl: string;
  networkPassphrase: string;
}

export function createRpcBalanceReader(options: RpcBalanceReaderOptions): BalanceReader {
  const server = new rpc.Server(options.rpcUrl);

  return {
    async getTokenBalance(tokenContractId, holder) {
      const tx = new TransactionBuilder(new Account(SIMULATION_SOURCE, "0"), {
        fee: "100",
        networkPassphrase: options.networkPassphrase,
      })
        .addOperation(
          Operation.invokeContractFunction({
            contract: tokenContractId,
            function: "balance",
            args: [new Address(holder).toScVal()],
          }),
        )
        .setTimeout(60)
        .build();

      const sim = await server.simulateTransaction(tx);
      if (!rpc.Api.isSimulationSuccess(sim)) {
        throw new Error(
          `Balance read failed for ${tokenContractId}: ${"error" in sim ? sim.error : "unknown simulation error"}`,
        );
      }
      const retval = sim.result?.retval;
      if (!retval) {
        throw new Error(`Balance read for ${tokenContractId} returned no result`);
      }
      return scValToBigInt(retval);
    },
  };
}
