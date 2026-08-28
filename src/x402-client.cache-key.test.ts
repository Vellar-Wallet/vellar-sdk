import { describe, expect, it } from "vitest";
import {
  migrateResourceCache,
  resourceCacheKey,
  type CachedResource,
  type ResourceCacheStore,
} from "./x402-client";

// Issue #221: the resource cache key must include the network, so a testnet
// lookup can never satisfy a mainnet one.

function memoryStore(seed: Record<string, CachedResource> = {}): ResourceCacheStore {
  const m = new Map<string, CachedResource>(Object.entries(seed));
  return {
    get: (k) => m.get(k),
    set: (k, v) => void m.set(k, v),
    delete: (k) => void m.delete(k),
    keys: () => m.keys(),
  };
}

const entry = (id: string) =>
  ({ requirements: { asset: id }, expiresAt: 1 }) as unknown as CachedResource;

describe("composite resource cache key (#221)", () => {
  it("uses the documented v2|<network>|<resourceId> format", () => {
    expect(resourceCacheKey("testnet", "https://api/x")).toBe("v2|testnet|https://api/x");
  });

  it("testnet and mainnet lookups for one resource do not collide", () => {
    const resource = "https://api.example.com/paid";
    const testnet = resourceCacheKey("testnet", resource);
    const mainnet = resourceCacheKey("mainnet", resource);
    expect(testnet).not.toBe(mainnet);

    const store = memoryStore();
    store.set(testnet, entry("TESTNET_ASSET"));
    store.set(mainnet, entry("MAINNET_ASSET"));

    expect(store.get(testnet)?.requirements).toMatchObject({ asset: "TESTNET_ASSET" });
    expect(store.get(mainnet)?.requirements).toMatchObject({ asset: "MAINNET_ASSET" });
  });

  it("a testnet write is not readable through the mainnet key", () => {
    const resource = "https://api.example.com/paid";
    const store = memoryStore();
    store.set(resourceCacheKey("testnet", resource), entry("TESTNET_ASSET"));
    expect(store.get(resourceCacheKey("mainnet", resource))).toBeUndefined();
  });

  it("distinct resources on one network stay distinct", () => {
    expect(resourceCacheKey("mainnet", "a")).not.toBe(resourceCacheKey("mainnet", "b"));
  });

  describe("migration of pre-composite entries", () => {
    it("clears unscoped keys written before the network segment existed", () => {
      const store = memoryStore({
        "https://api.example.com/paid": entry("STALE"),
        "another-bare-resource": entry("STALE"),
        [resourceCacheKey("mainnet", "https://api.example.com/paid")]: entry("FRESH"),
      });
      const removed = migrateResourceCache(store);
      expect(removed).toBe(2);
      expect([...store.keys()]).toEqual([
        resourceCacheKey("mainnet", "https://api.example.com/paid"),
      ]);
    });

    it("drops entries from a superseded key version", () => {
      const store = memoryStore({ "v1|mainnet|res": entry("OLD") });
      expect(migrateResourceCache(store)).toBe(1);
      expect([...store.keys()]).toEqual([]);
    });

    it("is a no-op on an already-migrated cache", () => {
      const store = memoryStore({ [resourceCacheKey("testnet", "res")]: entry("FRESH") });
      expect(migrateResourceCache(store)).toBe(0);
      expect([...store.keys()]).toHaveLength(1);
    });

    it("is a no-op on an empty cache", () => {
      expect(migrateResourceCache(memoryStore())).toBe(0);
    });
  });
});
