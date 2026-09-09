import { describe, expect, it } from "vitest";
import {
  buildBalanceCacheKey,
  clearUnscopedBalanceEntries,
  createInMemoryBalanceCacheStore,
  createNamespacedBalanceCache,
} from "./balances-network-namespace";

const TESTNET = "Test SDF Network ; September 2015";
const PUBNET = "Public Global Stellar Network ; September 2015";
const TOKEN = "CTOKEN1234567890";
const HOLDER = "GHOLDER1234567890";

describe("buildBalanceCacheKey", () => {
  it("composes network, token, and holder with a stable separator", () => {
    expect(buildBalanceCacheKey(TESTNET, TOKEN, HOLDER)).toBe(`${TESTNET}|${TOKEN}|${HOLDER}`);
  });
});

describe("createNamespacedBalanceCache", () => {
  it("stores and retrieves a value scoped to its network", () => {
    const cache = createNamespacedBalanceCache({ network: TESTNET, ttlMs: 60_000 });
    cache.set(TOKEN, HOLDER, 100n);
    expect(cache.get(TOKEN, HOLDER)).toBe(100n);
  });

  it("never mixes testnet and mainnet entries for the same token/holder pair", () => {
    const store = createInMemoryBalanceCacheStore();
    const testnetCache = createNamespacedBalanceCache({ network: TESTNET, ttlMs: 60_000, store });
    const mainnetCache = createNamespacedBalanceCache({ network: PUBNET, ttlMs: 60_000, store });

    testnetCache.set(TOKEN, HOLDER, 100n);
    mainnetCache.set(TOKEN, HOLDER, 999_999n);

    expect(testnetCache.get(TOKEN, HOLDER)).toBe(100n);
    expect(mainnetCache.get(TOKEN, HOLDER)).toBe(999_999n);
  });

  it("expires entries after the configured TTL", async () => {
    const cache = createNamespacedBalanceCache({ network: TESTNET, ttlMs: 1 });
    cache.set(TOKEN, HOLDER, 100n);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(cache.get(TOKEN, HOLDER)).toBeUndefined();
  });

  it("returns undefined for a lookup that was never cached", () => {
    const cache = createNamespacedBalanceCache({ network: TESTNET, ttlMs: 60_000 });
    expect(cache.get(TOKEN, HOLDER)).toBeUndefined();
  });

  it("clearNetwork only clears its own network's entries", () => {
    const store = createInMemoryBalanceCacheStore();
    const testnetCache = createNamespacedBalanceCache({ network: TESTNET, ttlMs: 60_000, store });
    const mainnetCache = createNamespacedBalanceCache({ network: PUBNET, ttlMs: 60_000, store });

    testnetCache.set(TOKEN, HOLDER, 100n);
    mainnetCache.set(TOKEN, HOLDER, 999_999n);

    const cleared = testnetCache.clearNetwork();

    expect(cleared).toBe(1);
    expect(testnetCache.get(TOKEN, HOLDER)).toBeUndefined();
    expect(mainnetCache.get(TOKEN, HOLDER)).toBe(999_999n);
  });
});

describe("clearUnscopedBalanceEntries (migration)", () => {
  it("deletes a legacy unscoped key and leaves scoped keys untouched", () => {
    const store = createInMemoryBalanceCacheStore();
    // Legacy pre-#233 entry: no network prefix at all.
    store.set(`${TOKEN}|${HOLDER}`, { value: 42n, expiresAt: Date.now() + 60_000 });
    // A properly-scoped entry that must survive the migration.
    const scopedKey = buildBalanceCacheKey(TESTNET, TOKEN, HOLDER);
    store.set(scopedKey, { value: 100n, expiresAt: Date.now() + 60_000 });

    const cleared = clearUnscopedBalanceEntries(store, [TESTNET, PUBNET]);

    expect(cleared).toBe(1);
    expect(store.get(`${TOKEN}|${HOLDER}`)).toBeUndefined();
    expect(store.get(scopedKey)).toBeDefined();
  });

  it("does not mistake a scoped key for one network as unscoped when checked against another", () => {
    const store = createInMemoryBalanceCacheStore();
    const scopedKey = buildBalanceCacheKey(PUBNET, TOKEN, HOLDER);
    store.set(scopedKey, { value: 5n, expiresAt: Date.now() + 60_000 });

    const cleared = clearUnscopedBalanceEntries(store, [TESTNET, PUBNET]);

    expect(cleared).toBe(0);
    expect(store.get(scopedKey)).toBeDefined();
  });

  it("returns 0 when the store has no unscoped entries", () => {
    const store = createInMemoryBalanceCacheStore();
    const scopedKey = buildBalanceCacheKey(TESTNET, TOKEN, HOLDER);
    store.set(scopedKey, { value: 5n, expiresAt: Date.now() + 60_000 });

    expect(clearUnscopedBalanceEntries(store, [TESTNET, PUBNET])).toBe(0);
  });
});
