import {
  Account,
  Address,
  Asset,
  Operation,
  rpc,
  scValToBigInt,
  scValToNative,
  TransactionBuilder,
  type xdr,
} from "@stellar/stellar-sdk";
import type { BalanceReader, TokenInfo } from "./balances";

// RPC-backed BalanceReader: simulates the token contract's `balance(id)`
// read — no signature, no fee, works for contract (C...) and classic (G...)
// holders. Exported via the "vellar-sdk/rpc" subpath so consumers that
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

/**
 * Thrown when the contract address is reachable but does not implement the
 * SEP-41 token interface (e.g. a non-token contract passed in by mistake):
 * the simulation reports a missing method, or the method returns the wrong
 * type. This is deterministic for a given contract, so it is never retried.
 * An RPC/network outage is NOT wrapped in this error — it propagates as the
 * underlying transport error, and other simulation failures (e.g. a contract
 * trap) surface as a plain "Balance read failed" Error.
 */
export class InvalidTokenContractError extends Error {
  constructor(
    readonly contractId: string,
    readonly method: string,
    detail: string,
  ) {
    super(
      `Contract ${contractId} does not implement the SEP-41 token interface (${method}): ${detail}`,
    );
    this.name = "InvalidTokenContractError";
  }
}

const WRONG_INTERFACE_PATTERN =
  /non-existent contract function|Error\(WasmVm, (?:MissingValue|InvalidAction)\)|UnreachableCodeReached/i;

/** Adds the SEP-41 decimals() read used for decimals-mismatch checks. */
export interface RpcBalanceReader extends BalanceReader {
  getTokenDecimals(tokenContractId: string): Promise<number>;
}

/**
 * Reads token balances over Soroban RPC.
 *
 * Errors from getTokenBalance / getTokenDecimals:
 * - InvalidTokenContractError: the contract is not a valid SEP-41 token
 *   (missing method or wrong return type). Not retried.
 * - Error("Balance read failed ..."): any other simulation failure.
 * - Transport errors from the RPC server are rethrown unchanged.
 */
export function createRpcBalanceReader(options: RpcBalanceReaderOptions): RpcBalanceReader {
  const server = new rpc.Server(options.rpcUrl);

  async function simulateRead(
    tokenContractId: string,
    method: string,
    args: xdr.ScVal[],
  ): Promise<xdr.ScVal> {
    const tx = new TransactionBuilder(new Account(SIMULATION_SOURCE, "0"), {
      fee: "100",
      networkPassphrase: options.networkPassphrase,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: tokenContractId,
          function: method,
          args,
        }),
      )
      .setTimeout(60)
      .build();

    const sim = await server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(sim)) {
      const detail = "error" in sim ? sim.error : "unknown simulation error";
      if (WRONG_INTERFACE_PATTERN.test(detail)) {
        throw new InvalidTokenContractError(tokenContractId, method, detail);
      }
      throw new Error(`Balance read failed for ${tokenContractId}: ${detail}`);
    }
    const retval = sim.result?.retval;
    if (!retval) {
      throw new Error(`Balance read for ${tokenContractId} returned no result`);
    }
    return retval;
  }

  return {
    async getTokenBalance(tokenContractId, holder) {
      const retval = await simulateRead(tokenContractId, "balance", [
        new Address(holder).toScVal(),
      ]);
      try {
        return scValToBigInt(retval);
      } catch {
        throw new InvalidTokenContractError(
          tokenContractId,
          "balance",
          "balance(id) did not return an integer",
        );
      }
    },
    async getTokenDecimals(tokenContractId) {
      const retval = await simulateRead(tokenContractId, "decimals", []);
      const decimals = scValToNative(retval);
      if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0) {
        throw new InvalidTokenContractError(
          tokenContractId,
          "decimals",
          "decimals() did not return a u32",
        );
      }
      return decimals;
    },
  };
}
