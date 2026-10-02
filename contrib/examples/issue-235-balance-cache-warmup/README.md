# Balance cache warm-up

Self-contained reference for issue [#235](https://github.com/Vellar-Wallet/vellar-sdk/issues/235): add a cache warm-up helper for frequently read wallet balances.

`createCachedBalanceReader(reader, { ttlMs })` wraps a `BalanceReader`-shaped
interface with an in-memory TTL cache, keyed by `(tokenContractId, holder)`.
`warmUpBalanceCache(reader, holder, { tokens })` pre-populates it across an
explicit, caller-chosen asset list — configurable warm-up selection, per the
issue's requirement — with concurrent reads and, by default, continues
warming up the rest of the list if one token's read fails.

- A failed underlying read is never cached, so the next call always retries
  against the network.
- `prime()` seeds a cache entry directly (e.g. from a value already known
  from elsewhere) without a network round-trip.
- `invalidate()` drops one entry, one token across all holders, or
  everything.

See also [`local-balance-cache`](../local-balance-cache) for a simpler
balance cache without the warm-up helper.

## Run it

```sh
npx tsx balance-cache-warmup.ts
```

## Tests

```sh
npx vitest run contrib/examples/issue-235-balance-cache-warmup
```
