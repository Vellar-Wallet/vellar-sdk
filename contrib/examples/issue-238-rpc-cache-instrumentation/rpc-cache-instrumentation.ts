// Reference for issue #238: rpc.ts's caching has no instrumentation hooks,
// making it hard for a consumer to evaluate cache effectiveness in their own
// telemetry (hit rate, which keys churn, etc.) without reimplementing the
// cache themselves. This wraps a plain TTL cache with optional
// onCacheHit/onCacheMiss callbacks, invoked at the exact point of access.

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface InstrumentedCacheOptions<T> {
  ttlMs: number;
  /** Called with the key on a cache hit, before the cached value is returned. */
  onCacheHit?: (key: string, value: T) => void;
  /** Called with the key on a cache miss (never cached, or expired). */
  onCacheMiss?: (key: string) => void;
}

export interface InstrumentedCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): void;
  size(): number;
}

/**
 * A minimal TTL cache with hit/miss instrumentation hooks — the pattern
 * rpc.ts's real caching (in balances-rpc.ts / tx-rpc.ts) can wrap with, so a
 * consumer wires up `onCacheHit`/`onCacheMiss` once and gets hit-rate
 * telemetry for every cached RPC call without touching the SDK's own
 * caching logic.
 *
 * The hooks are invoked synchronously and are expected to be
 * side-effect-only (metrics, logging) — an exception thrown from a hook
 * propagates to the caller of `get()`, it is not swallowed, since a
 * misbehaving hook silently eating errors would be a worse failure mode
 * than a loud one.
 */
export function createInstrumentedCache<T>(
  options: InstrumentedCacheOptions<T>,
): InstrumentedCache<T> {
  const store = new Map<string, CacheEntry<T>>();
  const { ttlMs, onCacheHit, onCacheMiss } = options;

  return {
    get(key) {
      const entry = store.get(key);
      const now = Date.now();

      if (entry && entry.expiresAt > now) {
        onCacheHit?.(key, entry.value);
        return entry.value;
      }

      if (entry) {
        // Expired: treat exactly like "never cached" for instrumentation
        // purposes — a consumer's hit-rate metric should not count an
        // expired-and-evicted entry as a hit.
        store.delete(key);
      }

      onCacheMiss?.(key);
      return undefined;
    },
    set(key, value) {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
    delete(key) {
      store.delete(key);
    },
    size() {
      return store.size;
    },
  };
}

/** Convenience helper: wraps an async fetcher with an instrumented cache,
 * the shape most RPC read paths actually need (get-or-fetch-and-populate). */
export function createInstrumentedCachedFetcher<T>(
  fetcher: (key: string) => Promise<T>,
  options: InstrumentedCacheOptions<T>,
): (key: string) => Promise<T> {
  const cache = createInstrumentedCache<T>(options);

  return async (key: string) => {
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const value = await fetcher(key);
    cache.set(key, value);
    return value;
  };
}
