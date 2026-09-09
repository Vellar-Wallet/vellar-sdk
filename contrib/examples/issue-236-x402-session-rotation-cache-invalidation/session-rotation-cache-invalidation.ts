// Reference for issue #236: after an x402 session key rotates,
// x402-client.ts's authorization cache must not keep serving results
// computed under the old key — a rotated-out key's cached "authorized"
// verdict is exactly the kind of stale-trust bug a session rotation exists
// to prevent.

export interface AuthorizationResult {
  authorized: boolean;
  sessionKeyId: string;
  computedAt: number;
}

export interface AuthorizationCacheStore {
  get(key: string): AuthorizationResult | undefined;
  set(key: string, value: AuthorizationResult): void;
  delete(key: string): void;
  keys(): IterableIterator<string>;
}

export function createInMemoryAuthorizationCacheStore(): AuthorizationCacheStore {
  const store = new Map<string, AuthorizationResult>();
  return {
    get: (key) => store.get(key),
    set: (key, value) => store.set(key, value),
    delete: (key) => store.delete(key),
    keys: () => store.keys(),
  };
}

export type DebugLogger = (message: string, context?: Record<string, unknown>) => void;

export interface SessionAwareAuthorizationCacheOptions {
  store?: AuthorizationCacheStore;
  /** Optional debug log sink — issue #236 asks for a debug log entry on
   * cache invalidation triggered by rotation, so a consumer can confirm in
   * their own logs that the invalidation actually ran. */
  debugLog?: DebugLogger;
}

export interface SessionAwareAuthorizationCache {
  get(resourceId: string): AuthorizationResult | undefined;
  set(resourceId: string, result: AuthorizationResult): void;
  /**
   * Invalidates every cached authorization computed under `oldSessionKeyId`.
   * Call this as part of session key rotation — before, after, or
   * concurrent with the rotation itself is fine, since this only removes
   * entries tagged with the specific key being retired; it never touches
   * entries for a different key (including the new one), so it cannot
   * accidentally clear a result that's actually still valid.
   */
  invalidateForRotatedKey(oldSessionKeyId: string): number;
}

/**
 * An authorization cache that tags every entry with the session key ID it
 * was computed under, so rotation can invalidate exactly the entries tied
 * to the retired key — not the whole cache (which would also throw away
 * still-valid results for unrelated resources under a key that never
 * rotated, in a multi-session consumer), and not nothing (which is #236's
 * actual bug).
 */
export function createSessionAwareAuthorizationCache(
  options: SessionAwareAuthorizationCacheOptions = {},
): SessionAwareAuthorizationCache {
  const store = options.store ?? createInMemoryAuthorizationCacheStore();
  const debugLog = options.debugLog;

  return {
    get(resourceId) {
      return store.get(resourceId);
    },
    set(resourceId, result) {
      store.set(resourceId, result);
    },
    invalidateForRotatedKey(oldSessionKeyId) {
      let invalidated = 0;
      for (const key of Array.from(store.keys())) {
        const entry = store.get(key);
        if (entry && entry.sessionKeyId === oldSessionKeyId) {
          store.delete(key);
          invalidated++;
        }
      }
      debugLog?.("x402: invalidated authorization cache entries after session key rotation", {
        oldSessionKeyId,
        invalidatedCount: invalidated,
      });
      return invalidated;
    },
  };
}
