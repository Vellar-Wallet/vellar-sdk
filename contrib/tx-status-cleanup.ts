/**
 * Cleanup helper for stale cached tx-status entries.
 *
 * The tx-status module polls until a transaction reaches a final state, but
 * callers that cache status entries in memory may accumulate stale entries for
 * transactions that completed long ago. This utility provides a configurable
 * cleanup pass that removes entries past a defined age.
 */

export interface CacheEntry<T> {
  value: T;
  createdAt: number;
}

export interface CleanupOptions {
  /** Maximum age in milliseconds before an entry is considered stale. Default: 1 hour. */
  maxAgeMs?: number;
  /** Current time provider for testability. Default: Date.now. */
  now?: () => number;
}

/**
 * Remove stale entries from a Map of cache entries.
 *
 * Returns a new Map containing only entries whose `createdAt` is within
 * `maxAgeMs` of the current time. The original map is not mutated.
 *
 * @param cache - Map of key → CacheEntry to clean
 * @param options - Cleanup configuration
 * @returns New Map with stale entries removed
 */
export function cleanupStaleEntries<T>(
  cache: Map<string, CacheEntry<T>>,
  options: CleanupOptions = {},
): Map<string, CacheEntry<T>> {
  const maxAgeMs = options.maxAgeMs ?? 60 * 60 * 1000;
  const now = options.now ?? Date.now;
  const cutoff = now() - maxAgeMs;
  const cleaned = new Map<string, CacheEntry<T>>();

  for (const [key, entry] of cache) {
    if (entry.createdAt >= cutoff) {
      cleaned.set(key, entry);
    }
  }

  return cleaned;
}

/**
 * Create a cached status store with built-in cleanup.
 *
 * Wraps a Map and exposes `get`, `set`, and `cleanup` methods. The `cleanup`
 * method prunes entries older than `maxAgeMs`.
 */
export function createCachedStatusStore<T>(options: CleanupOptions = {}) {
  const maxAgeMs = options.maxAgeMs ?? 60 * 60 * 1000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, CacheEntry<T>>();

  return {
    get(key: string): T | undefined {
      return cache.get(key)?.value;
    },

    set(key: string, value: T): void {
      cache.set(key, { value, createdAt: now() });
    },

    /** Remove entries older than maxAgeMs. Returns the number of entries removed. */
    cleanup(): number {
      const before = cache.size;
      const cutoff = now() - maxAgeMs;
      for (const [key, entry] of cache) {
        if (entry.createdAt < cutoff) {
          cache.delete(key);
        }
      }
      return before - cache.size;
    },

    /** Current number of entries in the cache. */
    get size(): number {
      return cache.size;
    },

    /** Expose the underlying cache for inspection (read-only). */
    entries(): ReadonlyMap<string, CacheEntry<T>> {
      return cache;
    },
  };
}
