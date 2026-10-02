/**
 * Batched trustline balance reads — one RPC call instead of N.
 *
 * Contributed for issue #216: reading balances for a wallet with several
 * trustlines issues one `simulateTransaction` per trustline. Running them
 * concurrently (see contrib/examples/batch-balance-lookup) hides the latency
 * behind Promise.all but still sends N requests, so the wallet is rate-limited
 * by the RPC provider exactly when it has the most assets to show.
 *
 * A Soroban simulation can carry more than one host function invocation, so N
 * `balance(id)` reads collapse into a single transaction and therefore a single
 * round trip. The per-token results come back positionally, in the order the
 * operations were added.
 *
 * ## Behaviour preserved from the per-call path
 *
 * The returned data shape is unchanged: `bigint` amounts, keyed by contract id,
 * in request order. What changes is the failure granularity, and that is why
 * the batch is not simply "always better":
 *
 * - A batched simulation fails as a unit. One bad contract id fails the whole
 *   call, where N separate calls would have failed exactly one.
 * - So on a batch-level failure this falls back to per-token reads, which
 *   restores the original per-item error isolation. The fallback is the slow
 *   path and only runs when the fast path could not answer.
 *
 * Batches are also chunked, because a simulation has a host-resource budget: a
 * transaction with too many invocations exceeds it and fails as a unit.
 */

/** Reads one balance. The existing, unbatched interface. */
export interface BalanceReader {
  getTokenBalance(tokenContractId: string, holder: string): Promise<bigint>;
}

/** Reads many balances in a single RPC call. */
export interface BatchBalanceReader {
  getTokenBalances(tokenContractIds: string[], holder: string): Promise<bigint[]>;
}

/**
 * Max invocations per simulated transaction. Kept well under the host resource
 * budget so a full chunk still simulates; exceeding it fails the whole batch.
 */
export const MAX_INVOCATIONS_PER_SIMULATION = 20;

export interface BatchedBalanceServiceOptions {
  maxBatchSize?: number;
  /**
   * Fall back to per-token reads when a batch fails, restoring per-item error
   * isolation. Disable to surface the batch failure directly.
   */
  fallbackToSingle?: boolean;
}

export type BalanceResult =
  | { contractId: string; ok: true; amount: bigint }
  | { contractId: string; ok: false; error: string };

export interface RpcCallStats {
  /** RPC calls issued — the number this issue exists to reduce. */
  rpcCalls: number;
  /** Calls issued by the per-token fallback path only. */
  fallbackCalls: number;
}

export interface BatchedBalanceService extends RpcCallStats {
  getBalances(holder: string, tokenContractIds: string[]): Promise<BalanceResult[]>;
  resetStats(): void;
}

export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new RangeError(`chunk size must be >= 1, got ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Wraps a batch-capable reader, with the single-read reader kept for fallback.
 */
export function createBatchedBalanceService(
  batchReader: BatchBalanceReader,
  singleReader: BalanceReader,
  options: BatchedBalanceServiceOptions = {},
): BatchedBalanceService {
  const maxBatchSize = options.maxBatchSize ?? MAX_INVOCATIONS_PER_SIMULATION;
  const fallbackToSingle = options.fallbackToSingle ?? true;

  let rpcCalls = 0;
  let fallbackCalls = 0;

  async function readChunk(ids: string[], holder: string): Promise<BalanceResult[]> {
    try {
      rpcCalls++;
      const amounts = await batchReader.getTokenBalances(ids, holder);
      if (amounts.length !== ids.length) {
        throw new Error(
          `batched balance read returned ${amounts.length} results for ${ids.length} tokens`,
        );
      }
      return ids.map((contractId, i) => ({ contractId, ok: true as const, amount: amounts[i]! }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!fallbackToSingle) {
        return ids.map((contractId) => ({ contractId, ok: false as const, error: message }));
      }

      // The batch failed as a unit, so we cannot tell which token caused it.
      // Re-read individually to recover the per-item error isolation the
      // unbatched path had.
      return Promise.all(
        ids.map(async (contractId) => {
          try {
            rpcCalls++;
            fallbackCalls++;
            const amount = await singleReader.getTokenBalance(contractId, holder);
            return { contractId, ok: true as const, amount };
          } catch (singleErr) {
            return {
              contractId,
              ok: false as const,
              error: singleErr instanceof Error ? singleErr.message : String(singleErr),
            };
          }
        }),
      );
    }
  }

  return {
    get rpcCalls() {
      return rpcCalls;
    },
    get fallbackCalls() {
      return fallbackCalls;
    },
    resetStats() {
      rpcCalls = 0;
      fallbackCalls = 0;
    },

    async getBalances(holder, tokenContractIds) {
      if (tokenContractIds.length === 0) return [];

      const chunks = chunk(tokenContractIds, maxBatchSize);
      const results = await Promise.all(chunks.map((ids) => readChunk(ids, holder)));
      // Flattened in chunk order, so the output order matches the input order.
      return results.flat();
    },
  };
}

/**
 * The unbatched baseline, kept so the benchmark test can compare call counts
 * against the exact behaviour that shipped before this change.
 */
export function createUnbatchedBalanceService(
  singleReader: BalanceReader,
): BatchedBalanceService {
  let rpcCalls = 0;

  return {
    get rpcCalls() {
      return rpcCalls;
    },
    fallbackCalls: 0,
    resetStats() {
      rpcCalls = 0;
    },

    async getBalances(holder, tokenContractIds) {
      return Promise.all(
        tokenContractIds.map(async (contractId) => {
          try {
            rpcCalls++;
            const amount = await singleReader.getTokenBalance(contractId, holder);
            return { contractId, ok: true as const, amount };
          } catch (err) {
            return {
              contractId,
              ok: false as const,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );
    },
  };
}

// --- Building the batched call --------------------------------------------

/**
 * One `balance(id)` invocation, as it would be added to the simulated tx.
 * Structural so this example does not depend on @stellar/stellar-sdk.
 */
export interface BalanceInvocation {
  contract: string;
  function: "balance";
  args: [holder: string];
}

/**
 * Describes the operations a single batched simulation would carry. The real
 * reader adds each of these via `Operation.invokeContractFunction` to ONE
 * TransactionBuilder and simulates once; the per-token results are read back
 * positionally from the simulation's result set.
 */
export function buildBalanceInvocations(
  tokenContractIds: string[],
  holder: string,
): BalanceInvocation[] {
  return tokenContractIds.map((contract) => ({
    contract,
    function: "balance" as const,
    args: [holder],
  }));
}
