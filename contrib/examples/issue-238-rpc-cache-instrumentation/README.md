# Cache hit/miss instrumentation hooks for rpc.ts (#238)

Self-contained reference for issue [#238](https://github.com/Vellar-Wallet/vellar-sdk/issues/238): rpc.ts's caching has no instrumentation hooks, making it hard for a consumer to evaluate cache effectiveness in their own telemetry.

## Hooks

```ts
createInstrumentedCache<T>({
  ttlMs: 60_000,
  onCacheHit: (key, value) => metrics.increment("rpc.cache.hit", { key }),
  onCacheMiss: (key) => metrics.increment("rpc.cache.miss", { key }),
});
```

- `onCacheHit(key, value)` fires when a non-expired entry is found.
- `onCacheMiss(key)` fires when the key was never cached, or its entry has expired (an expired entry counts as a miss for instrumentation purposes, not a hit — it's evicted at the same point).
- Both hooks are invoked synchronously at the point of access, before `get()` returns. An exception thrown from a hook propagates to the caller — it is not swallowed, since a misbehaving hook silently eating errors is a worse failure mode than a loud one.

`createInstrumentedCachedFetcher` wraps an async fetcher with the get-or-fetch-and-populate shape most RPC read paths need.

## Run tests

```bash
npx vitest run contrib/examples/issue-238-rpc-cache-instrumentation/rpc-cache-instrumentation.test.ts
```
