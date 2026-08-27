// Account state helpers (technical-doc.md §5.2: view balances and account
// metadata). Smart accounts are contract addresses, so balances come from
// token-contract reads (SAC `balance(id)`), never Horizon /accounts. This
// module is dependency-free; the RPC-backed reader lives in balances-rpc.ts.

export interface TokenInfo {
  symbol: string;
  /** Token (SAC or custom) contract id the balance is read from. */
  contractId: string;
  decimals: number;
}

export interface TokenBalance extends TokenInfo {
  /** Raw units (e.g. stroops for XLM). */
  amount: bigint;
}

export interface BalanceReader {
  getTokenBalance(tokenContractId: string, holder: string): Promise<bigint>;
}

export interface BalanceService {
  getBalances(holder: string): Promise<TokenBalance[]>;
}

/** Stats exposed by a negative-caching balance reader (for debugging). */
export interface NegativeCacheStats {
  /** Times a not-found result was served from cache instead of the reader. */
  negativeCacheHits: number;
  /** Times the reader was called because no valid cache entry existed. */
  negativeCacheMisses: number;
  /** hits / (hits + misses), or 0 when no lookups have occurred. */
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

/**
 * Wraps a BalanceReader with a short-lived negative cache for failed lookups
 * (unknown or invalid token contracts). Successful reads are never cached.
 */
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

export function createBalanceService(reader: BalanceReader, tokens: TokenInfo[]): BalanceService {
  return {
    async getBalances(holder) {
      return Promise.all(
        tokens.map(async (token) => ({
          ...token,
          amount: await reader.getTokenBalance(token.contractId, holder),
        })),
      );
    },
  };
}

/**
 * Formats raw token units as a decimal string: no rounding, trailing zeros
 * trimmed ("100000000000", 7 -> "10000"; "10000001", 7 -> "1.0000001").
 */
export function formatTokenAmount(amount: bigint, decimals: number): string {
  if (decimals < 0 || !Number.isInteger(decimals)) {
    throw new RangeError(`decimals must be a non-negative integer, got ${decimals}`);
  }
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  const sign = negative ? "-" : "";
  return fraction === "" ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}
