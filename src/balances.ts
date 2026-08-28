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
  /** Fetch balances for many assets in one call; partial failures are per-item. */
  getBalancesBatch(holder: string, tokens: TokenInfo[]): Promise<BatchBalanceResult[]>;
}

/** Maximum number of assets in a single batch balance request. */
export const MAX_BATCH_BALANCE_SIZE = 32;

export type BatchBalanceResult =
  | { contractId: string; success: true; amount: bigint }
  | { contractId: string; success: false; error: string };

export class BatchBalanceSizeError extends Error {
  constructor(
    readonly maxSize: number,
    readonly requested: number,
  ) {
    super(`batch balance request exceeds max size of ${maxSize}, got ${requested}`);
    this.name = "BatchBalanceSizeError";
  }
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
    getBalancesBatch(holder, batchTokens) {
      return fetchBalancesBatch(reader, holder, batchTokens);
    },
  };
}

export async function fetchBalancesBatch(
  reader: BalanceReader,
  holder: string,
  tokens: Pick<TokenInfo, "contractId">[],
): Promise<BatchBalanceResult[]> {
  if (tokens.length > MAX_BATCH_BALANCE_SIZE) {
    throw new BatchBalanceSizeError(MAX_BATCH_BALANCE_SIZE, tokens.length);
  }
  return Promise.all(
    tokens.map(async ({ contractId }) => {
      try {
        const amount = await reader.getTokenBalance(contractId, holder);
        return { contractId, success: true as const, amount };
      } catch (err) {
        return {
          contractId,
          success: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
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

// ── balance-read cache (#235) ───────────────────────────────────────────────
//
// Balance reads go through the network (RPC simulation — see
// balances-rpc.ts), so a cold cache after eviction/TTL expiry means the
// first read after that point pays full round-trip latency. This wraps any
// BalanceReader with a TTL cache, plus a warmUpBalanceCache() helper to
// pre-populate it ahead of time (e.g. right after a wallet connects, before
// the balances UI first renders). In-memory and dependency-free, consistent
// with the rest of this module.

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
  /**
   * Directly populates the cache for one token/holder pair without going
   * through `getTokenBalance`'s cache-check. Useful when a caller already
   * has a fresh balance value from elsewhere (e.g. an event/webhook) and
   * wants to seed the cache with it.
   */
  prime(tokenContractId: string, holder: string, amount: bigint): void;
  /** Drops one cached entry, or every entry when called with no arguments. */
  invalidate(tokenContractId?: string, holder?: string): void;
}

function cacheKey(tokenContractId: string, holder: string): string {
  return `${tokenContractId}:${holder}`;
}

/**
 * Wraps `reader` with a TTL cache keyed by (tokenContractId, holder). A read
 * within `ttlMs` of the last successful read for that pair is served from
 * memory; otherwise it goes to `reader` and the result is cached.
 *
 * A failed underlying read is never cached — the next call retries against
 * the network rather than repeating (or getting stuck on) a stale error.
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
   * Which tokens to warm up. Required — a bare `BalanceReader` has no
   * notion of "all tokens" (only `BalanceService` does, via its configured
   * `TokenInfo[]`), so there's no sensible default to fall back to. Pass a
   * subset to warm up only the assets your UI shows first (e.g. just the
   * native asset, deferring others).
   */
  tokens: TokenInfo[];
  /**
   * If one token's read fails, continue warming up the rest instead of
   * aborting the whole batch. Defaults to `true` — a warm-up is a
   * best-effort optimization, not something that should surface as a hard
   * failure to the caller (the cold-cache path still works, just slower).
   */
  continueOnError?: boolean;
}

export interface WarmUpBalanceCacheResult {
  /** Contract ids that were successfully read and cached. */
  warmed: string[];
  /** Contract ids that failed, with the error each one threw. */
  failed: Array<{ contractId: string; error: unknown }>;
}

/**
 * Pre-populates `reader`'s cache for `holder` across `options.tokens`, so
 * the next real read (e.g. the balances UI's first render) is a cache hit
 * instead of paying cold network latency. Reads run concurrently.
 */
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
        // A plain read: getTokenBalance() itself populates the cache on a
        // miss (or refreshes it on an expired entry) — no separate write
        // needed. prime() exists on CachedBalanceReader for callers seeding
        // a value they already have from elsewhere, not for this path.
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
