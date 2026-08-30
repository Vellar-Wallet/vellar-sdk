# Tx Status Cache TTL

Self-contained reference for issue [#237](https://github.com/Vellar-Wallet/vellar-sdk/issues/237): configurable TTL for tx-status polling cache (default 2_000 ms, range 0–60_000).

Finalized `success`/`failed` results are cached; `pending` is always fetched fresh.

## Run tests

```bash
npx vitest run contrib/examples/issue-237-tx-status-cache-ttl/tx-status-cache-ttl.test.ts
```

## Configuration reference

| Option | Default | Valid range | Notes |
|--------|---------|-------------|-------|
| `cacheTtlMs` | `2_000` | `0`–`60_000` | Set `0` to disable caching |
