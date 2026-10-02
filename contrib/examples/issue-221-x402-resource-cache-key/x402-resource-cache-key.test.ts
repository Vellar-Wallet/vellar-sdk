import { describe, expect, it, vi } from "vitest";
import {
  buildResourceCacheKey,
  CACHE_KEY_VERSION,
  clearUnscopedEntries,
  createNetworkScopedResourceCache,
  type CachedResource,
  type ResourceLookup,
} from "./x402-resource-cache-key";

const TESTNET = "stellar:testnet";
const MAINNET = "stellar:pubnet";

function resource(network: string): CachedResource {
  return network === TESTNET
    ? {
        resourceId: "/premium-feed",
        network: TESTNET,
        asset: "CTESTUSDC",
        payTo: "CTESTSELLER",
        amount: 10n,
      }
    : {
        resourceId: "/premium-feed",
        network: MAINNET,
        asset: "CMAINUSDC",
        payTo: "CMAINSELLER",
        amount: 5_000n,
      };
}

function stubLookup(): ResourceLookup {
  return {
    lookupResource: vi.fn(async (_resourceId: string, network: string) => resource(network)),
  };
}

describe("buildResourceCacheKey", () => {
  it("composes version, network and resource id in a fixed order", () => {
    expect(buildResourceCacheKey("/premium-feed", TESTNET)).toBe(
      `${CACHE_KEY_VERSION}|${TESTNET}|/premium-feed`,
    );
  });

  it("produces different keys for the same resource on different networks", () => {
    expect(buildResourceCacheKey("/premium-feed", TESTNET)).not.toBe(
      buildResourceCacheKey("/premium-feed", MAINNET),
    );
  });

  it("rejects a missing network so an unscoped key can never be written", () => {
    expect(() => buildResourceCacheKey("/premium-feed", "")).toThrow(/network identifier/);
  });

  it("rejects a missing resource id", () => {
    expect(() => buildResourceCacheKey("", TESTNET)).toThrow(/resource id/);
  });
});

describe("createNetworkScopedResourceCache", () => {
  it("does not collide testnet and mainnet lookups for the same resource id", async () => {
    const lookup = stubLookup();
    const cache = createNetworkScopedResourceCache(lookup);

    const testnet = await cache.get("/premium-feed", TESTNET);
    const mainnet = await cache.get("/premium-feed", MAINNET);

    expect(testnet.payTo).toBe("CTESTSELLER");
    expect(testnet.asset).toBe("CTESTUSDC");
    expect(testnet.amount).toBe(10n);

    expect(mainnet.payTo).toBe("CMAINSELLER");
    expect(mainnet.asset).toBe("CMAINUSDC");
    expect(mainnet.amount).toBe(5_000n);

    // Both networks missed: the second lookup was NOT served from the first's entry.
    expect(lookup.lookupResource).toHaveBeenCalledTimes(2);
    expect(cache.hits).toBe(0);
    expect(cache.misses).toBe(2);
    expect(cache.size()).toBe(2);
  });

  it("still serves a repeat lookup on the same network from cache", async () => {
    const lookup = stubLookup();
    const cache = createNetworkScopedResourceCache(lookup);

    await cache.get("/premium-feed", TESTNET);
    const second = await cache.get("/premium-feed", TESTNET);

    expect(second.payTo).toBe("CTESTSELLER");
    expect(lookup.lookupResource).toHaveBeenCalledTimes(1);
    expect(cache.hits).toBe(1);
  });

  it("expires entries after the TTL", async () => {
    let time = 0;
    const lookup = stubLookup();
    const cache = createNetworkScopedResourceCache(lookup, new Map(), {
      ttlMs: 1_000,
      now: () => time,
    });

    await cache.get("/premium-feed", TESTNET);
    time = 1_500;
    await cache.get("/premium-feed", TESTNET);

    expect(lookup.lookupResource).toHaveBeenCalledTimes(2);
  });

  it("invalidates one network without touching the other", async () => {
    const lookup = stubLookup();
    const cache = createNetworkScopedResourceCache(lookup);

    await cache.get("/premium-feed", TESTNET);
    await cache.get("/premium-feed", MAINNET);

    expect(cache.invalidateNetwork(TESTNET)).toBe(1);
    expect(cache.size()).toBe(1);

    await cache.get("/premium-feed", MAINNET);
    expect(cache.hits).toBe(1);
  });
});

describe("clearUnscopedEntries", () => {
  it("removes pre-#221 entries keyed by bare resource id", () => {
    const store = new Map<string, unknown>([
      ["/premium-feed", { legacy: true }],
      ["/other", { legacy: true }],
      [`${CACHE_KEY_VERSION}|${TESTNET}|/premium-feed`, { legacy: false }],
    ]);

    expect(clearUnscopedEntries(store)).toBe(2);
    expect([...store.keys()]).toEqual([`${CACHE_KEY_VERSION}|${TESTNET}|/premium-feed`]);
  });

  it("runs on construction so a persisted store cannot serve unscoped hits", async () => {
    const lookup = stubLookup();
    const store = new Map<string, { expiresAt: number; value: CachedResource }>([
      // A legacy entry holding MAINNET data under the bare resource id.
      ["/premium-feed", { expiresAt: Number.MAX_SAFE_INTEGER, value: resource(MAINNET) }],
    ]);

    const cache = createNetworkScopedResourceCache(lookup, store, { ttlMs: 60_000 });
    expect(cache.migratedEntries).toBe(1);

    // The testnet lookup must hit the network, not the migrated mainnet record.
    const testnet = await cache.get("/premium-feed", TESTNET);
    expect(testnet.payTo).toBe("CTESTSELLER");
    expect(lookup.lookupResource).toHaveBeenCalledTimes(1);
  });
});
