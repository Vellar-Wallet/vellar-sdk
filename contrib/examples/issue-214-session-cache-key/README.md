# Session Cache Key

Self-contained reference for issue [#214](https://github.com/Vellar-Wallet/vellar-sdk/issues/214): a structured, index-friendly key format for the local session cache, replacing the unstructured flat key.

## Run tests

```bash
npx vitest run contrib/examples/issue-214-session-cache-key/session-cache-key.test.ts
```

## Why

`createWebStorageAdapter` in `src/session.ts` defaults to a single flat key, `"vellar.session"`. Every network and every wallet share one storage slot, so:

- switching networks overwrites the other network's session, and
- "invalidate everything for mainnet" is not expressible — you either clear one hardcoded key or all of storage.

## Key format

```
vellar:session:v1:<network>:<walletId>
└─┬──┘ └─┬───┘ └┬┘ └──┬───┘ └───┬────┘
  │      │      │     │         └─ wallet id (C-address), percent-encoded
  │      │      │     └─ "testnet" | "mainnet"
  │      │      └─ key-format version, bumped when the LAYOUT changes
  │      └─ namespace within the vellar prefix
  └─ product prefix — everything vellar writes starts here
```

Read left to right, each segment narrows the scope, so **a prefix is always a valid invalidation scope**: `vellar:session:v1:mainnet:` matches exactly the mainnet sessions and nothing else. That is the property the flat key lacked.

`v1` versions the key **layout**, not the session payload schema. Bump it when segments are added, removed, or reordered; old keys then stop matching cleanly instead of being misparsed.

## Escaping

`:` is the separator and the one character forbidden inside a segment. `encodeSegment` percent-encodes it — and escapes `%` **first**, so a literal `%3A` in a wallet id does not decode into a separator that was never there.

This is what makes a cross-network collision impossible rather than merely unlikely: a wallet id of `X:mainnet:CVICTIM` on testnet cannot produce a key that parses as a mainnet entry.

## Usage

```ts
import { createScopedSessionCache, sessionCacheKey } from "./session-cache-key";

const cache = createScopedSessionCache(window.localStorage);

// Write — the key is derived from the session, so it can never be mis-scoped.
cache.write(session);

// Read one wallet on one network.
const restored = cache.read({ network: "mainnet", walletId: "CWALLET1" });

// List every session on a network (multi-wallet switchers).
cache.list("testnet");

// Invalidate a whole network in one call. Returns how many were removed.
cache.clearScope("mainnet");

// Or build a key directly.
sessionCacheKey({ network: "testnet", walletId: "CWALLET1" });
// → "vellar:session:v1:testnet:CWALLET1"
```

`sessionCacheKey` is the only place a key is constructed — a caller that formats one by hand defeats the format.

## API

| Export | Purpose |
|--------|---------|
| `sessionCacheKey(parts)` | Build a key. Throws `InvalidCacheKeyError` on an empty `walletId` |
| `parseSessionCacheKey(key)` | Parse back to `{ network, walletId }`. Throws on anything this format did not build |
| `isSessionCacheKey(key)` | Non-throwing predicate |
| `sessionCacheScope(network?)` | Prefix for one network, or for all sessions |
| `createScopedSessionCache(storage)` | `read` / `write` / `remove` / `list` / `clearScope` |
| `migrateLegacyKey(storage)` | Move a `"vellar.session"` blob to its structured key |

## Behaviour notes

- `clearScope` matches on the prefix **and** re-parses each key, so a foreign key that merely shares the prefix is left alone.
- Storage keys are snapshotted before removal — deleting during enumeration reindexes `storage.key(i)` and would skip entries.
- Reads never throw: malformed JSON and non-session values return `null`, matching the `restore()` contract in `src/session.ts`.
- `migrateLegacyKey` takes the network and wallet id from the stored session itself, so the rewrite cannot mis-scope an existing entry. It is idempotent and leaves an unreadable blob in place.
