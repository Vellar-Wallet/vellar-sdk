// Self-contained reference for issue #235: add a cache warm-up helper for
// frequently read wallet balances. Balance reads in the real SDK go through
// the network (RPC simulation), so a cold cache after eviction/TTL expiry
// means the first read after that point pays full round-trip latency, with
// no way to pre-populate it ahead of time.
//
// This models a minimal BalanceReader-shaped interface (mirroring
// src/balances.ts's real one) with a TTL cache and a warmUpBalanceCache()
// helper — the warm-up asset selection is explicit and configurable, per
// the issue's requirement.
//
// Run with: npx tsx balance-cache-warmup.ts

export interface TokenInfo {
  symbol: string;
  contractId: string;
  decimals: number;
}

export interface BalanceReader {
  getTokenBalance(tokenContractId: string, holder: string): Promise<bigint>;
}

interface CacheEntry {
  amount: bigint;
  cachedAt: number;
}

export interface CachedBalanceReaderOptions {
  /** How long a cached balance is served before the next read hits the network. */
  ttlMs: number;
  /** Injectable clock, primarily for tests. Defaults to `() => Date.now()`. */
  now?: () => number;
}

export interface CachedBalanceReader extends BalanceReader {
  /** Seeds the cache for one token/holder pair without a network round-trip. */
  prime(tokenContractId: string, holder: string, amount: bigint): void;
  /** Drops one cached entry, or every entry when called with no arguments. */
  invalidate(tokenContractId?: string, holder?: string): void;
}

function cacheKey(tokenContractId: string, holder: string): string {
  return `${tokenContractId}:${holder}`;
}

/**
 * Wraps `reader` with a TTL cache keyed by (tokenContractId, holder). A
 * failed underlying read is never cached — the next call always retries
 * against the network instead of repeating a stale error.
 */
export function createCachedBalanceReader(
  reader: BalanceReader,
  options: CachedBalanceReaderOptions,
): CachedBalanceReader {
  const { ttlMs } = options;
  const now = options.now ?? (() => Date.now());
  const cache = new Map<string, CacheEntry>();

  return {
    async getTokenBalance(tokenContractId, holder) {
      const key = cacheKey(tokenContractId, holder);
      const entry = cache.get(key);
      if (entry !== undefined && now() - entry.cachedAt < ttlMs) {
        return entry.amount;
      }
      const amount = await reader.getTokenBalance(tokenContractId, holder);
      cache.set(key, { amount, cachedAt: now() });
      return amount;
    },

    prime(tokenContractId, holder, amount) {
      cache.set(cacheKey(tokenContractId, holder), { amount, cachedAt: now() });
    },

    invalidate(tokenContractId, holder) {
      if (tokenContractId === undefined) {
        cache.clear();
        return;
      }
      if (holder === undefined) {
        for (const key of cache.keys()) {
          if (key.startsWith(`${tokenContractId}:`)) cache.delete(key);
        }
        return;
      }
      cache.delete(cacheKey(tokenContractId, holder));
    },
  };
}

export interface WarmUpBalanceCacheOptions {
  /**
   * Which tokens to warm up — explicit and configurable, per the issue's
   * requirement. Pass a subset (e.g. just the native asset) to warm up only
   * what a UI shows first.
   */
  tokens: TokenInfo[];
  /**
   * If one token's read fails, continue warming up the rest instead of
   * aborting the whole batch. Defaults to `true`.
   */
  continueOnError?: boolean;
}

export interface WarmUpBalanceCacheResult {
  warmed: string[];
  failed: Array<{ contractId: string; error: unknown }>;
}

/** Pre-populates `reader`'s cache for `holder` across `options.tokens`, concurrently. */
export async function warmUpBalanceCache(
  reader: CachedBalanceReader,
  holder: string,
  options: WarmUpBalanceCacheOptions,
): Promise<WarmUpBalanceCacheResult> {
  const { tokens, continueOnError = true } = options;
  const warmed: string[] = [];
  const failed: Array<{ contractId: string; error: unknown }> = [];

  await Promise.all(
    tokens.map(async (token) => {
      try {
        await reader.getTokenBalance(token.contractId, holder);
        warmed.push(token.contractId);
      } catch (error) {
        if (!continueOnError) throw error;
        failed.push({ contractId: token.contractId, error });
      }
    }),
  );

  return { warmed, failed };
}

async function main() {
  const xlm: TokenInfo = { symbol: "XLM", contractId: "CNATIVE", decimals: 7 };
  const usdc: TokenInfo = { symbol: "USDC", contractId: "CUSDC", decimals: 7 };

  const mockReader: BalanceReader = {
    async getTokenBalance(contractId) {
      console.log(`  (network read: ${contractId})`);
      return contractId === "CNATIVE" ? 50_0000000n : 100_0000000n;
    },
  };

  const cached = createCachedBalanceReader(mockReader, { ttlMs: 15_000 });

  console.log("Warming up cache for [XLM, USDC]...");
  const result = await warmUpBalanceCache(cached, "CHOLDER", { tokens: [xlm, usdc] });
  console.log(`  warmed: ${result.warmed.join(", ")}`);

  console.log("\nReading again — should be cache hits (no 'network read' log line):");
  console.log(`  XLM: ${await cached.getTokenBalance("CNATIVE", "CHOLDER")}`);
  console.log(`  USDC: ${await cached.getTokenBalance("CUSDC", "CHOLDER")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
