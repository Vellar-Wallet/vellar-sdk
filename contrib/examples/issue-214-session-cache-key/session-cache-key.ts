/**
 * Structured cache key format for the local session cache.
 *
 * Contributed for issue #214: `createWebStorageAdapter` in src/session.ts
 * defaults to a single flat key (`"vellar.session"`), so every network and
 * every wallet share one storage slot. Switching networks overwrites the other
 * network's session, and "invalidate everything for mainnet" is not expressible
 * — you either clear one hardcoded key or all of storage.
 *
 * ## Key format
 *
 *     vellar:session:v1:<network>:<walletId>
 *     └─┬──┘ └─┬───┘ └┬┘ └──┬───┘ └───┬────┘
 *       │      │      │     │         └─ wallet id (C-address), percent-encoded
 *       │      │      │     └─ "testnet" | "mainnet"
 *       │      │      └─ key-format version, bumped when the LAYOUT changes
 *       │      └─ namespace within the vellar prefix
 *       └─ product prefix — everything vellar writes starts here
 *
 * Read left to right, each segment narrows the scope, so a prefix is always a
 * valid invalidation scope: `vellar:session:v1:mainnet:` matches exactly the
 * mainnet sessions and nothing else. That is the property the flat key lacked.
 *
 * `:` is the separator, and it is the ONE character forbidden in a segment
 * (see `encodeSegment`) — that is what makes parsing unambiguous and makes a
 * cross-network collision impossible rather than merely unlikely.
 *
 * The `v1` version is the key LAYOUT, not the session payload schema. Bump it
 * when segments are added, removed, or reordered; old keys then simply stop
 * matching and are collected by `clearScope`, rather than being misparsed.
 *
 * Run with: npx vitest run contrib/examples/issue-214-session-cache-key
 */

import type { Network, WalletSession } from "../../../src/types";

/** Product prefix. Every key this module builds starts with it. */
export const CACHE_KEY_PREFIX = "vellar";
/** Namespace within the prefix. Siblings (balances, policies) would sit alongside. */
export const CACHE_KEY_NAMESPACE = "session";
/** Key LAYOUT version — bumped when segments change, not when the payload does. */
export const CACHE_KEY_VERSION = "v1";
/** Segment separator. Forbidden inside a segment; see `encodeSegment`. */
export const CACHE_KEY_SEPARATOR = ":";

export interface SessionCacheKeyParts {
  network: Network;
  /** The wallet's C-address. Scopes the key so two wallets never share a slot. */
  walletId: string;
}

export class InvalidCacheKeyError extends Error {
  constructor(
    readonly key: string,
    reason: string,
  ) {
    super(`invalid session cache key "${key}": ${reason}`);
    this.name = "InvalidCacheKeyError";
  }
}

/**
 * Percent-encodes the separator so a segment can never split a key.
 *
 * Only `:` and `%` are touched. `%` must be escaped first, otherwise decoding
 * a literal `%3A` in a wallet id would produce a separator that was never
 * there — the classic escaping bug this ordering avoids.
 */
export function encodeSegment(value: string): string {
  return value.replace(/%/g, "%25").replace(/:/g, "%3A");
}

export function decodeSegment(value: string): string {
  return value.replace(/%3A/g, ":").replace(/%25/g, "%");
}

function assertNetwork(value: string, key: string): Network {
  if (value !== "testnet" && value !== "mainnet") {
    throw new InvalidCacheKeyError(key, `unknown network segment "${value}"`);
  }
  return value;
}

/**
 * Builds the structured key. This is the ONLY place a session cache key is
 * constructed — a caller that formats one by hand defeats the format.
 */
export function sessionCacheKey({ network, walletId }: SessionCacheKeyParts): string {
  if (walletId === "") {
    throw new InvalidCacheKeyError("<empty>", "walletId must not be empty");
  }
  assertNetwork(network, "<building>");
  return [
    CACHE_KEY_PREFIX,
    CACHE_KEY_NAMESPACE,
    CACHE_KEY_VERSION,
    encodeSegment(network),
    encodeSegment(walletId),
  ].join(CACHE_KEY_SEPARATOR);
}

/**
 * Prefix matching every session for one network, or every session this key
 * format owns when `network` is omitted.
 *
 * The trailing separator is deliberate: without it `…:v1:main` would also
 * match a hypothetical `…:v1:mainnet-staging:…`.
 */
export function sessionCacheScope(network?: Network): string {
  const base = [CACHE_KEY_PREFIX, CACHE_KEY_NAMESPACE, CACHE_KEY_VERSION].join(
    CACHE_KEY_SEPARATOR,
  );
  return network === undefined
    ? `${base}${CACHE_KEY_SEPARATOR}`
    : `${base}${CACHE_KEY_SEPARATOR}${encodeSegment(network)}${CACHE_KEY_SEPARATOR}`;
}

/** Parses a key back to its parts. Throws on anything this format did not build. */
export function parseSessionCacheKey(key: string): SessionCacheKeyParts {
  const segments = key.split(CACHE_KEY_SEPARATOR);
  if (segments.length !== 5) {
    throw new InvalidCacheKeyError(key, `expected 5 segments, got ${segments.length}`);
  }
  const [prefix, namespace, version, network, walletId] = segments as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (prefix !== CACHE_KEY_PREFIX) {
    throw new InvalidCacheKeyError(key, `expected prefix "${CACHE_KEY_PREFIX}"`);
  }
  if (namespace !== CACHE_KEY_NAMESPACE) {
    throw new InvalidCacheKeyError(key, `expected namespace "${CACHE_KEY_NAMESPACE}"`);
  }
  if (version !== CACHE_KEY_VERSION) {
    throw new InvalidCacheKeyError(key, `unsupported key version "${version}"`);
  }
  if (walletId === "") {
    throw new InvalidCacheKeyError(key, "walletId segment is empty");
  }
  return {
    network: assertNetwork(decodeSegment(network), key),
    walletId: decodeSegment(walletId),
  };
}

/** True when `key` was built by this format at the current version. */
export function isSessionCacheKey(key: string): boolean {
  try {
    parseSessionCacheKey(key);
    return true;
  } catch {
    return false;
  }
}

/** Storage surface, plus the enumeration needed for prefix invalidation. */
export interface EnumerableStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

export interface ScopedSessionCache {
  read(parts: SessionCacheKeyParts): WalletSession | null;
  write(session: WalletSession & { accountId: string }): void;
  remove(parts: SessionCacheKeyParts): void;
  /** Every session in storage this format owns, newest-first order not guaranteed. */
  list(network?: Network): { parts: SessionCacheKeyParts; session: WalletSession }[];
  /** Drops every session for one network, or all of them when omitted. */
  clearScope(network?: Network): number;
}

function isWalletSession(value: unknown): value is WalletSession {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.accountId === "string" &&
    v.accountId.length > 0 &&
    (v.network === "testnet" || v.network === "mainnet") &&
    typeof v.connected === "boolean" &&
    v.authMethod === "passkey" &&
    typeof v.createdAt === "string" &&
    typeof v.lastActiveAt === "string"
  );
}

/** Snapshot first: removing during enumeration reindexes `storage.key(i)`. */
function allKeys(storage: EnumerableStorageLike): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null) keys.push(key);
  }
  return keys;
}

/**
 * Session cache where every read, write, and invalidation goes through the
 * structured key. `write` derives the key from the session itself, so a
 * session can never be filed under another network's or wallet's key.
 */
export function createScopedSessionCache(storage: EnumerableStorageLike): ScopedSessionCache {
  return {
    read(parts) {
      const raw = storage.getItem(sessionCacheKey(parts));
      if (raw === null) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        return isWalletSession(parsed) ? parsed : null;
      } catch {
        // Unreadable storage must not brick startup — same contract as
        // `restore()` in src/session.ts.
        return null;
      }
    },

    write(session) {
      const key = sessionCacheKey({ network: session.network, walletId: session.accountId });
      storage.setItem(key, JSON.stringify(session));
    },

    remove(parts) {
      storage.removeItem(sessionCacheKey(parts));
    },

    list(network) {
      const scope = sessionCacheScope(network);
      const out: { parts: SessionCacheKeyParts; session: WalletSession }[] = [];
      for (const key of allKeys(storage)) {
        if (!key.startsWith(scope) || !isSessionCacheKey(key)) continue;
        const raw = storage.getItem(key);
        if (raw === null) continue;
        try {
          const parsed: unknown = JSON.parse(raw);
          if (isWalletSession(parsed)) {
            out.push({ parts: parseSessionCacheKey(key), session: parsed });
          }
        } catch {
          // Skip an unreadable entry rather than failing the whole listing.
        }
      }
      return out;
    },

    clearScope(network) {
      const scope = sessionCacheScope(network);
      let removed = 0;
      for (const key of allKeys(storage)) {
        // The prefix check alone would also match a foreign key that happens to
        // share the prefix; parsing confirms this format actually owns it.
        if (key.startsWith(scope) && isSessionCacheKey(key)) {
          storage.removeItem(key);
          removed++;
        }
      }
      return removed;
    },
  };
}

/** The flat key `createWebStorageAdapter` defaults to today. */
export const LEGACY_SESSION_KEY = "vellar.session";

/**
 * Moves a session stored under the legacy flat key to its structured key.
 *
 * The network and wallet id come from the stored session itself, so the
 * rewrite cannot mis-scope an existing entry. Returns the new key, or `null`
 * when there is nothing valid to move.
 */
export function migrateLegacyKey(
  storage: EnumerableStorageLike,
  legacyKey: string = LEGACY_SESSION_KEY,
): string | null {
  const raw = storage.getItem(legacyKey);
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isWalletSession(parsed)) return null;

  const key = sessionCacheKey({ network: parsed.network, walletId: parsed.accountId });
  storage.setItem(key, JSON.stringify(parsed));
  storage.removeItem(legacyKey);
  return key;
}
