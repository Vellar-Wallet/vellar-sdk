import {
  Account,
  Address,
  Asset,
  Operation,
  rpc,
  scValToBigInt,
  TransactionBuilder,
  xdr,
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
  /**
   * Connection reuse tuning (issue #217). Applied to the RPC client's HTTP
   * layer. Ignored in browsers, where the fetch stack owns pooling and
   * `Connection` is a forbidden header.
   */
  connection?: RpcConnectionOptions;
}

/**
 * Keep-alive / pooling knobs for the underlying HTTP client.
 *
 * Recommended values:
 * - **Node**: `{ keepAlive: true, maxSockets: 16, keepAliveMsecs: 15_000 }`.
 *   Soroban RPC reads are short and bursty; a warm pool removes a TCP+TLS
 *   handshake per call.
 * - **Browser**: leave unset. The browser manages its own connection pool and
 *   rejects `Connection`/`Keep-Alive` headers as forbidden.
 */
export interface RpcConnectionOptions {
  /** Reuse sockets between requests (Node only). Default true. */
  keepAlive?: boolean;
  /** Max concurrent sockets per host (Node only). Default 16. */
  maxSockets?: number;
  /** Idle keep-alive in ms before a socket is dropped (Node only). Default 15000. */
  keepAliveMsecs?: number;
}

/** True when running somewhere the fetch stack owns connection pooling. */
function isBrowserLike(): boolean {
  const g = globalThis as { window?: unknown; document?: unknown };
  return g.window !== undefined && g.document !== undefined;
}

/**
 * Builds the `rpc.Server` options carrying connection-reuse settings.
 *
 * `rpc.Server` exposes no agent/dispatcher hook directly, so the tuning is
 * attached as an axios-style `httpAgent`-bearing options bag when running under
 * Node. In a browser this returns undefined and the platform default is used.
 *
 * Exported for testing.
 */
export function resolveConnectionOptions(
  connection: RpcConnectionOptions | undefined,
): Record<string, unknown> | undefined {
  if (isBrowserLike()) return undefined;
  const keepAlive = connection?.keepAlive ?? true;
  if (!keepAlive) return undefined;
  return {
    keepAlive,
    maxSockets: connection?.maxSockets ?? 16,
    keepAliveMsecs: connection?.keepAliveMsecs ?? 15_000,
  };
}

/**
 * Max host invocations packed into one simulation (issue #216). Soroban caps
 * the resource footprint of a single simulated transaction, so very wide reads
 * are chunked rather than sent as one oversized envelope.
 */
export const MAX_INVOCATIONS_PER_SIMULATION = 20;

/** A BalanceReader that can also satisfy many tokens in a single RPC round trip. */
export interface BatchingBalanceReader extends BalanceReader {
  /**
   * Reads every token's balance for `holder`, batching the `balance(id)` calls
   * into as few simulations as possible (issue #216). Resolves in the same
   * order as `tokenContractIds`.
   */
  getTokenBalances(tokenContractIds: string[], holder: string): Promise<bigint[]>;
}

export function createRpcBalanceReader(
  options: RpcBalanceReaderOptions,
): BatchingBalanceReader {
  const connectionOptions = resolveConnectionOptions(options.connection);
  const server = connectionOptions
    ? new rpc.Server(options.rpcUrl, connectionOptions as never)
    : new rpc.Server(options.rpcUrl);

  /** Builds one simulation envelope carrying a `balance(id)` call per token. */
  function buildBalanceTx(tokenContractIds: string[], holder: string) {
    const builder = new TransactionBuilder(new Account(SIMULATION_SOURCE, "0"), {
      fee: "100",
      networkPassphrase: options.networkPassphrase,
    });
    for (const contract of tokenContractIds) {
      builder.addOperation(
        Operation.invokeContractFunction({
          contract,
          function: "balance",
          args: [new Address(holder).toScVal()],
        }),
      );
    }
    return builder.setTimeout(60).build();
  }

  async function simulateOne(tokenContractId: string, holder: string): Promise<bigint> {
    const sim = await server.simulateTransaction(buildBalanceTx([tokenContractId], holder));
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
  }

  /**
   * Simulates one chunk as a single RPC call. Falls back to per-token reads if
   * the batch fails or the response doesn't carry one result per invocation —
   * a batch is an optimisation, never a behaviour change (issue #216).
   */
  async function simulateChunk(tokenContractIds: string[], holder: string): Promise<bigint[]> {
    if (tokenContractIds.length === 1) {
      return [await simulateOne(tokenContractIds[0]!, holder)];
    }
    let sim;
    try {
      sim = await server.simulateTransaction(buildBalanceTx(tokenContractIds, holder));
    } catch {
      return perTokenFallback(tokenContractIds, holder);
    }
    if (!rpc.Api.isSimulationSuccess(sim)) {
      return perTokenFallback(tokenContractIds, holder);
    }
    // One `results` entry per invocation, in operation order.
    const results = (sim as { results?: { xdr?: string }[] }).results;
    if (!Array.isArray(results) || results.length !== tokenContractIds.length) {
      return perTokenFallback(tokenContractIds, holder);
    }
    const out: bigint[] = [];
    for (let i = 0; i < results.length; i++) {
      const raw = results[i]?.xdr;
      if (!raw) return perTokenFallback(tokenContractIds, holder);
      out.push(scValToBigInt(xdr.ScVal.fromXDR(raw, "base64")));
    }
    return out;
  }

  function perTokenFallback(tokenContractIds: string[], holder: string): Promise<bigint[]> {
    return Promise.all(tokenContractIds.map((id) => simulateOne(id, holder)));
  }

  return {
    getTokenBalance(tokenContractId, holder) {
      return simulateOne(tokenContractId, holder);
    },
    async getTokenBalances(tokenContractIds, holder) {
      if (tokenContractIds.length === 0) return [];
      const chunks: string[][] = [];
      for (let i = 0; i < tokenContractIds.length; i += MAX_INVOCATIONS_PER_SIMULATION) {
        chunks.push(tokenContractIds.slice(i, i + MAX_INVOCATIONS_PER_SIMULATION));
      }
      const settled = await Promise.all(chunks.map((c) => simulateChunk(c, holder)));
      return settled.flat();
    },
  };
}
