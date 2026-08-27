/**
 * Negative cache for unknown asset balance lookups.
 *
 * Contributed for issue #234: cache not-found balance reads so repeated lookups
 * for invalid token contracts do not hit the RPC every time.
 */

export interface BalanceReader {
  getTokenBalance(tokenContractId: string, holder: string): Promise<bigint>;
}

export interface NegativeCacheStats {
  negativeCacheHits: number;
  negativeCacheMisses: number;
  negativeCacheHitRate(): number;
}

export interface NegativeCachingBalanceReaderOptions {
  /**
   * How long to remember a not-found balance lookup. 30s is short enough that a
   * newly-deployed token becomes visible quickly, but long enough to stop RPC
   * hammering on permanently invalid contract ids during UI re-renders.
   */
  negativeCacheTtlMs?: number;
  now?: () => number;
}

export function createNegativeCachingBalanceReader(
  reader: BalanceReader,
  options: NegativeCachingBalanceReaderOptions = {},
): BalanceReader & NegativeCacheStats {
  const ttlMs = options.negativeCacheTtlMs ?? 30_000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { expiresAt: number; error: Error }>();
  let negativeCacheHits = 0;
  let negativeCacheMisses = 0;

  return {
    get negativeCacheHits() {
      return negativeCacheHits;
    },
    get negativeCacheMisses() {
      return negativeCacheMisses;
    },
    negativeCacheHitRate() {
      const total = negativeCacheHits + negativeCacheMisses;
      return total === 0 ? 0 : negativeCacheHits / total;
    },

    async getTokenBalance(tokenContractId, holder) {
      const key = `${tokenContractId}:${holder}`;
      const cached = cache.get(key);
      const t = now();
      if (cached && cached.expiresAt > t) {
        negativeCacheHits++;
        throw cached.error;
      }

      negativeCacheMisses++;
      try {
        return await reader.getTokenBalance(tokenContractId, holder);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        cache.set(key, { expiresAt: t + ttlMs, error });
        throw error;
      }
    },
  };
}
