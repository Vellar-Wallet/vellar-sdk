import { describe, expect, it } from "vitest";
import type { WalletSession } from "../../../src/types";
import {
  CACHE_KEY_VERSION,
  createScopedSessionCache,
  decodeSegment,
  encodeSegment,
  InvalidCacheKeyError,
  isSessionCacheKey,
  LEGACY_SESSION_KEY,
  migrateLegacyKey,
  parseSessionCacheKey,
  sessionCacheKey,
  sessionCacheScope,
  type EnumerableStorageLike,
} from "./session-cache-key";

function sessionFor(
  accountId: string,
  network: "testnet" | "mainnet" = "testnet",
): WalletSession {
  return {
    accountId,
    network,
    connected: true,
    authMethod: "passkey",
    createdAt: "2026-08-01T00:00:00.000Z",
    lastActiveAt: "2026-08-01T00:00:00.000Z",
  };
}

function fakeStorage(initial?: Record<string, string>): EnumerableStorageLike & {
  map: Map<string, string>;
} {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
  };
}

describe("sessionCacheKey", () => {
  it("builds the documented format", () => {
    expect(sessionCacheKey({ network: "testnet", walletId: "CWALLET1" })).toBe(
      `vellar:session:${CACHE_KEY_VERSION}:testnet:CWALLET1`,
    );
  });

  it("is deterministic", () => {
    const parts = { network: "mainnet", walletId: "CWALLET1" } as const;
    expect(sessionCacheKey(parts)).toBe(sessionCacheKey(parts));
  });

  it("rejects an empty walletId", () => {
    expect(() => sessionCacheKey({ network: "testnet", walletId: "" })).toThrow(
      InvalidCacheKeyError,
    );
  });
});

describe("key collisions across networks", () => {
  it("produces different keys for the same wallet on different networks", () => {
    const testnet = sessionCacheKey({ network: "testnet", walletId: "CWALLET1" });
    const mainnet = sessionCacheKey({ network: "mainnet", walletId: "CWALLET1" });
    expect(testnet).not.toBe(mainnet);
  });

  it("keeps both networks' sessions side by side in storage", () => {
    const storage = fakeStorage();
    const cache = createScopedSessionCache(storage);

    cache.write(sessionFor("CWALLET1", "testnet"));
    cache.write(sessionFor("CWALLET1", "mainnet"));

    expect(storage.map.size).toBe(2);
    expect(cache.read({ network: "testnet", walletId: "CWALLET1" })?.network).toBe("testnet");
    expect(cache.read({ network: "mainnet", walletId: "CWALLET1" })?.network).toBe("mainnet");
  });

  it("does not collide across wallets on the same network", () => {
    const storage = fakeStorage();
    const cache = createScopedSessionCache(storage);

    cache.write(sessionFor("CWALLET1", "testnet"));
    cache.write(sessionFor("CWALLET2", "testnet"));

    expect(storage.map.size).toBe(2);
    expect(cache.read({ network: "testnet", walletId: "CWALLET1" })?.accountId).toBe("CWALLET1");
    expect(cache.read({ network: "testnet", walletId: "CWALLET2" })?.accountId).toBe("CWALLET2");
  });

  it("generates unique keys across the whole network x wallet matrix", () => {
    const networks = ["testnet", "mainnet"] as const;
    const wallets = ["CA", "CB", "CC", "CA:B", "CA%B", "C"];
    const keys = networks.flatMap((network) =>
      wallets.map((walletId) => sessionCacheKey({ network, walletId })),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("a wallet id containing the separator cannot forge another network's key", () => {
    // Without escaping, walletId "…:mainnet:CVICTIM" would produce a key that
    // parses as a mainnet entry. Escaping makes that unrepresentable.
    const forged = sessionCacheKey({
      network: "testnet",
      walletId: "X:mainnet:CVICTIM",
    });
    const real = sessionCacheKey({ network: "mainnet", walletId: "CVICTIM" });

    expect(forged).not.toBe(real);
    expect(parseSessionCacheKey(forged).network).toBe("testnet");
    expect(parseSessionCacheKey(forged).walletId).toBe("X:mainnet:CVICTIM");
  });

  it("reading one network never returns the other network's session", () => {
    const storage = fakeStorage();
    const cache = createScopedSessionCache(storage);
    cache.write(sessionFor("CWALLET1", "mainnet"));
    expect(cache.read({ network: "testnet", walletId: "CWALLET1" })).toBeNull();
  });
});

describe("segment escaping", () => {
  it("escapes the separator", () => {
    expect(encodeSegment("a:b")).toBe("a%3Ab");
  });

  it("escapes percent before the separator so decoding is unambiguous", () => {
    // A literal "%3A" in the input must survive as "%3A", not become ":".
    expect(decodeSegment(encodeSegment("a%3Ab"))).toBe("a%3Ab");
    expect(decodeSegment(encodeSegment("a:b"))).toBe("a:b");
  });

  it.each(["plain", "a:b", "a%b", "a%3Ab", "%", ":", "%%::"])("round-trips %o", (value) => {
    expect(decodeSegment(encodeSegment(value))).toBe(value);
  });

  it("round-trips an escaped wallet id through a full key", () => {
    const walletId = "C:WALLET%1";
    expect(parseSessionCacheKey(sessionCacheKey({ network: "testnet", walletId })).walletId).toBe(
      walletId,
    );
  });
});

describe("parseSessionCacheKey", () => {
  it("round-trips build → parse", () => {
    const parts = { network: "mainnet", walletId: "CWALLET1" } as const;
    expect(parseSessionCacheKey(sessionCacheKey(parts))).toEqual(parts);
  });

  it.each([
    ["vellar:session:v1:testnet", "too few segments"],
    ["vellar:session:v1:testnet:C1:extra", "too many segments"],
    ["other:session:v1:testnet:C1", "wrong prefix"],
    ["vellar:balances:v1:testnet:C1", "wrong namespace"],
    ["vellar:session:v9:testnet:C1", "unsupported version"],
    ["vellar:session:v1:devnet:C1", "unknown network"],
    ["vellar:session:v1:testnet:", "empty walletId"],
    ["vellar.session", "the legacy flat key"],
    ["", "empty string"],
  ])("rejects %o (%s)", (key) => {
    expect(() => parseSessionCacheKey(key)).toThrow(InvalidCacheKeyError);
    expect(isSessionCacheKey(key)).toBe(false);
  });

  it("accepts a key it built", () => {
    expect(isSessionCacheKey(sessionCacheKey({ network: "testnet", walletId: "C1" }))).toBe(true);
  });
});

describe("sessionCacheScope", () => {
  it("scopes to one network", () => {
    expect(sessionCacheScope("mainnet")).toBe(`vellar:session:${CACHE_KEY_VERSION}:mainnet:`);
  });

  it("scopes to all sessions when the network is omitted", () => {
    expect(sessionCacheScope()).toBe(`vellar:session:${CACHE_KEY_VERSION}:`);
  });

  it("a network scope prefixes only that network's keys", () => {
    const mainnet = sessionCacheKey({ network: "mainnet", walletId: "C1" });
    const testnet = sessionCacheKey({ network: "testnet", walletId: "C1" });
    expect(mainnet.startsWith(sessionCacheScope("mainnet"))).toBe(true);
    expect(testnet.startsWith(sessionCacheScope("mainnet"))).toBe(false);
  });

  it("the trailing separator prevents a partial network-name match", () => {
    // "…:v1:main" would prefix-match a "mainnet-staging" style segment;
    // "…:v1:mainnet:" cannot.
    expect(sessionCacheScope("mainnet").endsWith(":")).toBe(true);
    expect("vellar:session:v1:mainnet-staging:C1".startsWith(sessionCacheScope("mainnet"))).toBe(
      false,
    );
  });
});

describe("createScopedSessionCache", () => {
  it("derives the write key from the session, not the caller", () => {
    const storage = fakeStorage();
    createScopedSessionCache(storage).write(sessionFor("CWALLET1", "mainnet"));
    expect([...storage.map.keys()]).toEqual([
      sessionCacheKey({ network: "mainnet", walletId: "CWALLET1" }),
    ]);
  });

  it("returns null for a missing entry", () => {
    const cache = createScopedSessionCache(fakeStorage());
    expect(cache.read({ network: "testnet", walletId: "CNONE" })).toBeNull();
  });

  it("returns null for malformed JSON instead of throwing", () => {
    const key = sessionCacheKey({ network: "testnet", walletId: "C1" });
    const cache = createScopedSessionCache(fakeStorage({ [key]: "{not json" }));
    expect(cache.read({ network: "testnet", walletId: "C1" })).toBeNull();
  });

  it("returns null for a stored value that is not a session", () => {
    const key = sessionCacheKey({ network: "testnet", walletId: "C1" });
    const cache = createScopedSessionCache(fakeStorage({ [key]: JSON.stringify({ a: 1 }) }));
    expect(cache.read({ network: "testnet", walletId: "C1" })).toBeNull();
  });

  it("removes only the addressed entry", () => {
    const storage = fakeStorage();
    const cache = createScopedSessionCache(storage);
    cache.write(sessionFor("C1", "testnet"));
    cache.write(sessionFor("C1", "mainnet"));

    cache.remove({ network: "testnet", walletId: "C1" });

    expect(cache.read({ network: "testnet", walletId: "C1" })).toBeNull();
    expect(cache.read({ network: "mainnet", walletId: "C1" })).not.toBeNull();
  });

  it("lists sessions for one network", () => {
    const storage = fakeStorage();
    const cache = createScopedSessionCache(storage);
    cache.write(sessionFor("C1", "testnet"));
    cache.write(sessionFor("C2", "testnet"));
    cache.write(sessionFor("C3", "mainnet"));

    const testnet = cache.list("testnet");
    expect(testnet).toHaveLength(2);
    expect(testnet.map((e) => e.parts.walletId).sort()).toEqual(["C1", "C2"]);
    expect(cache.list()).toHaveLength(3);
  });

  it("ignores foreign and malformed keys when listing", () => {
    const storage = fakeStorage({
      "unrelated-app-key": JSON.stringify(sessionFor("CX")),
      "vellar:session:v9:testnet:COLD": JSON.stringify(sessionFor("COLD")),
      [LEGACY_SESSION_KEY]: JSON.stringify(sessionFor("CLEGACY")),
    });
    const cache = createScopedSessionCache(storage);
    cache.write(sessionFor("C1", "testnet"));

    expect(cache.list()).toHaveLength(1);
    expect(cache.list()[0]!.parts.walletId).toBe("C1");
  });

  it("clearScope drops one network and leaves the other intact", () => {
    const storage = fakeStorage();
    const cache = createScopedSessionCache(storage);
    cache.write(sessionFor("C1", "testnet"));
    cache.write(sessionFor("C2", "testnet"));
    cache.write(sessionFor("C3", "mainnet"));

    expect(cache.clearScope("testnet")).toBe(2);
    expect(cache.list("testnet")).toHaveLength(0);
    expect(cache.list("mainnet")).toHaveLength(1);
  });

  it("clearScope with no network drops every session this format owns", () => {
    const storage = fakeStorage({ "unrelated-app-key": "keep me" });
    const cache = createScopedSessionCache(storage);
    cache.write(sessionFor("C1", "testnet"));
    cache.write(sessionFor("C2", "mainnet"));

    expect(cache.clearScope()).toBe(2);
    expect(storage.map.get("unrelated-app-key")).toBe("keep me");
  });

  it("clearScope leaves a foreign key that merely shares the prefix", () => {
    const storage = fakeStorage({ "vellar:session:v1:testnet:C1:extra": "not ours" });
    const cache = createScopedSessionCache(storage);
    cache.write(sessionFor("C1", "testnet"));

    expect(cache.clearScope("testnet")).toBe(1);
    expect(storage.map.get("vellar:session:v1:testnet:C1:extra")).toBe("not ours");
  });

  it("clearScope removes every match despite index shifting during removal", () => {
    const storage = fakeStorage();
    const cache = createScopedSessionCache(storage);
    for (let i = 0; i < 10; i++) cache.write(sessionFor(`C${i}`, "testnet"));

    expect(cache.clearScope("testnet")).toBe(10);
    expect(storage.map.size).toBe(0);
  });

  it("returns 0 when nothing matches", () => {
    expect(createScopedSessionCache(fakeStorage()).clearScope("mainnet")).toBe(0);
  });
});

describe("migrateLegacyKey", () => {
  it("moves a flat-key session to its structured key", () => {
    const session = sessionFor("CWALLET1", "mainnet");
    const storage = fakeStorage({ [LEGACY_SESSION_KEY]: JSON.stringify(session) });

    const key = migrateLegacyKey(storage);

    expect(key).toBe(sessionCacheKey({ network: "mainnet", walletId: "CWALLET1" }));
    expect(storage.map.has(LEGACY_SESSION_KEY)).toBe(false);
    expect(createScopedSessionCache(storage).read({ network: "mainnet", walletId: "CWALLET1" })).toEqual(
      session,
    );
  });

  it("scopes the rewritten key from the stored session, not a caller argument", () => {
    const storage = fakeStorage({
      [LEGACY_SESSION_KEY]: JSON.stringify(sessionFor("CWALLET1", "testnet")),
    });
    expect(migrateLegacyKey(storage)).toContain(":testnet:");
  });

  it("returns null when there is no legacy entry", () => {
    expect(migrateLegacyKey(fakeStorage())).toBeNull();
  });

  it("returns null and keeps the blob when it is not a valid session", () => {
    const storage = fakeStorage({ [LEGACY_SESSION_KEY]: "{not json" });
    expect(migrateLegacyKey(storage)).toBeNull();
    expect(storage.map.has(LEGACY_SESSION_KEY)).toBe(true);
  });

  it("is idempotent", () => {
    const storage = fakeStorage({
      [LEGACY_SESSION_KEY]: JSON.stringify(sessionFor("C1", "testnet")),
    });
    migrateLegacyKey(storage);
    expect(migrateLegacyKey(storage)).toBeNull();
    expect(storage.map.size).toBe(1);
  });
});
