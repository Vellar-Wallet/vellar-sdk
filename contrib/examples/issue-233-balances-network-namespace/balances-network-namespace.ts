// Reference for issue #233: namespace balances-rpc's cache keys by network,
// so a consumer that reads balances against more than one network (e.g.
// testnet during development, pubnet in production) never serves a
// testnet-cached balance for a mainnet lookup, or vice versa.

export interface CacheEntry {
  value: bigint;
  expiresAt: number;
}

export interface BalanceCacheStore {
  get(key: string): CacheEntry | undefined;
  set(key: string, entry: CacheEntry): void;
  delete(key: string): void;
  keys(): IterableIterator<string>;
}

/** A trivial in-memory store, sufficient for tests and single-process use. */
export function createInMemoryBalanceCacheStore(): BalanceCacheStore {
  const store = new Map<string, CacheEntry>();
  return {
    get: (key) => store.get(key),
    set: (key, entry) => store.set(key, entry),
    delete: (key) => store.delete(key),
    keys: () => store.keys(),
  };
}

/**
 * Composite cache key: `<network>|<tokenContractId>|<holder>`. `|` cannot
 * appear in a Stellar network passphrase or a strkey, so it is a safe,
 * unambiguous separator — no encoding step is needed for either field.
 */
export function buildBalanceCacheKey(
  network: string,
  tokenContractId: string,
  holder: string,
): string {
  return `${network}|${tokenContractId}|${holder}`;
}

export interface NamespacedBalanceCacheOptions {
  network: string;
  ttlMs: number;
  store?: BalanceCacheStore;
}

export interface NamespacedBalanceCache {
  get(tokenContractId: string, holder: string): bigint | undefined;
  set(tokenContractId: string, holder: string, value: bigint): void;
  /** Removes every entry for this cache's network. Used by the migration
   * helper below, and available directly for a consumer that wants to force
   * a refresh after, e.g., a known chain reorg. */
  clearNetwork(): number;
}

/**
 * A balance cache scoped to one network. Two `NamespacedBalanceCache`
 * instances pointed at the same underlying `store` but different `network`
 * values never read or clear each other's entries, even for the same
 * `tokenContractId`/`holder` pair — the network is part of the key, not an
 * external convention a caller has to remember to apply consistently.
 */
export function createNamespacedBalanceCache(
  options: NamespacedBalanceCacheOptions,
): NamespacedBalanceCache {
  const store = options.store ?? createInMemoryBalanceCacheStore();
  const { network, ttlMs } = options;

  return {
    get(tokenContractId, holder) {
      const key = buildBalanceCacheKey(network, tokenContractId, holder);
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(tokenContractId, holder, value) {
      const key = buildBalanceCacheKey(network, tokenContractId, holder);
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
    clearNetwork() {
      const prefix = `${network}|`;
      let cleared = 0;
      for (const key of Array.from(store.keys())) {
        if (key.startsWith(prefix)) {
          store.delete(key);
          cleared++;
        }
      }
      return cleared;
    },
  };
}

/**
 * Migration step (per issue #233's requirement): a pre-#233 deployment may
 * have populated `store` with unscoped keys — bare `<tokenContractId>|
 * <holder>` pairs, with no network prefix at all. Those entries can't be
 * safely rewritten under a guessed network (that's exactly the cross-network
 * mixing bug #233 exists to fix), so they're deleted outright; the next
 * balance read repopulates them correctly under a namespaced key.
 *
 * A key is recognized as legacy/unscoped by NOT matching the
 * `<network>|<contractId>|<holder>` shape for any of the networks in
 * `knownNetworks` — this only clears keys this migration can positively
 * identify as pre-#233, rather than guessing based on segment count alone.
 */
export function clearUnscopedBalanceEntries(
  store: BalanceCacheStore,
  knownNetworks: readonly string[],
): number {
  let cleared = 0;
  for (const key of Array.from(store.keys())) {
    const isScoped = knownNetworks.some((network) => key.startsWith(`${network}|`));
    if (!isScoped) {
      store.delete(key);
      cleared++;
    }
  }
  return cleared;
}
