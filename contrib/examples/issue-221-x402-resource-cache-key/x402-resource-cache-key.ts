/**
 * Network-scoped cache key for x402 resource lookups.
 *
 * Contributed for issue #221: the x402 client caches resource lookups keyed
 * only by resource id, so a consumer that talks to more than one network can
 * serve a testnet resource record for a mainnet lookup (and vice versa). The
 * two records describe different `payTo` addresses, different asset contract
 * ids, and different prices — a collision is a wrong-network payment, not just
 * a stale read.
 *
 * The fix is to compose the network identifier into the key.
 *
 * ## Composite key format
 *
 * ```
 * v2|<network>|<resourceId>
 * ```
 *
 * - `v2`      — key-schema version. Bumping this is what makes the migration in
 *               `clearUnscopedEntries` possible: any entry that does not carry
 *               the current prefix predates network scoping and is discarded.
 * - `network` — the CAIP-2 chain id or SDK network name the lookup was resolved
 *               against (`stellar:testnet`, `stellar:pubnet`, ...). Both the
 *               separator and the field order are fixed so the prefix
 *               `v2|<network>|` can be used for range operations such as
 *               "invalidate everything cached for testnet".
 * - `resourceId` — the resource identifier as supplied by the caller.
 *
 * `|` is the separator because it cannot appear in a CAIP-2 chain id. Callers
 * whose resource ids may contain `|` should pass an already-encoded id; the key
 * builder does not escape, so that ambiguity would be theirs to resolve.
 */

/** Current cache key schema version. Bump when the key layout changes. */
export const CACHE_KEY_VERSION = "v2";

/** Field separator for the composite key. Never valid inside a CAIP-2 id. */
const KEY_SEPARATOR = "|";

export interface CachedResource {
  resourceId: string;
  /** Network the record was resolved against, e.g. "stellar:testnet". */
  network: string;
  /** Token contract the resource is priced in. Differs per network. */
  asset: string;
  /** Recipient address for the payment. Differs per network. */
  payTo: string;
  /** Price in raw token units. */
  amount: bigint;
}

export interface ResourceLookup {
  lookupResource(resourceId: string, network: string): Promise<CachedResource>;
}

export interface ResourceCacheOptions {
  /** Entry lifetime. Defaults to 60s — resource pricing changes rarely. */
  ttlMs?: number;
  /** Injectable clock (tests). */
  now?: () => number;
}

export interface ResourceCacheStats {
  hits: number;
  misses: number;
  /** Entries dropped by the unscoped-key migration on construction. */
  migratedEntries: number;
}

export interface NetworkScopedResourceCache extends ResourceCacheStats {
  get(resourceId: string, network: string): Promise<CachedResource>;
  /** Exposed so callers can inspect/pre-seed with the exact key layout. */
  keyFor(resourceId: string, network: string): string;
  /** Drop every entry cached for one network, leaving other networks intact. */
  invalidateNetwork(network: string): number;
  size(): number;
}

/**
 * Builds the composite cache key. See the module comment for the format.
 */
export function buildResourceCacheKey(resourceId: string, network: string): string {
  if (!network) {
    throw new Error("x402 resource cache key requires a network identifier");
  }
  if (!resourceId) {
    throw new Error("x402 resource cache key requires a resource id");
  }
  return `${CACHE_KEY_VERSION}${KEY_SEPARATOR}${network}${KEY_SEPARATOR}${resourceId}`;
}

/**
 * Migration step: remove entries written before network scoping existed.
 *
 * A pre-#221 entry is keyed by the bare resource id, so it carries no version
 * prefix and cannot be attributed to a network. There is no safe way to infer
 * which network it came from, so it is deleted rather than rewritten — the next
 * lookup repopulates it under the correct scoped key. Returns the number of
 * entries removed so callers can log/report the one-off cost.
 */
export function clearUnscopedEntries(store: Map<string, unknown>): number {
  const prefix = `${CACHE_KEY_VERSION}${KEY_SEPARATOR}`;
  let removed = 0;
  for (const key of [...store.keys()]) {
    if (!key.startsWith(prefix)) {
      store.delete(key);
      removed++;
    }
  }
  return removed;
}

export function createNetworkScopedResourceCache(
  lookup: ResourceLookup,
  store: Map<string, { expiresAt: number; value: CachedResource }> = new Map(),
  options: ResourceCacheOptions = {},
): NetworkScopedResourceCache {
  const ttlMs = options.ttlMs ?? 60_000;
  const now = options.now ?? Date.now;

  // Run the migration once, at construction, against whatever the caller
  // handed us (a persisted store may still hold pre-#221 unscoped keys).
  const migratedEntries = clearUnscopedEntries(store);

  let hits = 0;
  let misses = 0;

  return {
    get hits() {
      return hits;
    },
    get misses() {
      return misses;
    },
    migratedEntries,

    keyFor: buildResourceCacheKey,

    size() {
      return store.size;
    },

    invalidateNetwork(network) {
      const prefix = `${CACHE_KEY_VERSION}${KEY_SEPARATOR}${network}${KEY_SEPARATOR}`;
      let removed = 0;
      for (const key of [...store.keys()]) {
        if (key.startsWith(prefix)) {
          store.delete(key);
          removed++;
        }
      }
      return removed;
    },

    async get(resourceId, network) {
      const key = buildResourceCacheKey(resourceId, network);
      const entry = store.get(key);
      const t = now();
      if (entry && entry.expiresAt > t) {
        hits++;
        return entry.value;
      }

      misses++;
      const value = await lookup.lookupResource(resourceId, network);
      store.set(key, { expiresAt: t + ttlMs, value });
      return value;
    },
  };
}
