# Batched Trustline Balances

Self-contained reference for issue [#216](https://github.com/Vellar-Wallet/vellar-sdk/issues/216): collapse the per-trustline `balance(id)` reads into a single batched RPC call.

## The problem

Reading balances for a wallet with N trustlines issues N `simulateTransaction` calls. [`batch-balance-lookup`](../batch-balance-lookup) already runs them concurrently, which hides the latency behind `Promise.all` — but it still sends N requests, so the wallet gets rate-limited by the RPC provider exactly when it has the most assets to display.

A Soroban simulation can carry more than one host function invocation. N `balance(id)` reads therefore fit in one transaction and one round trip, with results read back positionally in operation order.

## Call count

| Trustlines | Before | After |
| --- | --- | --- |
| 1 | 1 | 1 |
| 4 | 4 | 1 |
| 10 | 10 | 1 |
| 25 | 25 | 2 |

Batches are chunked at `MAX_INVOCATIONS_PER_SIMULATION` (20) because a simulation has a host-resource budget — too many invocations in one transaction exceeds it and fails the batch as a unit.

## No behaviour change

The returned shape is identical: `bigint` amounts keyed by contract id, in request order. The test suite asserts batched and unbatched results are `toEqual` for both the all-success and the partial-failure case.

The one real difference is failure granularity, and it is handled rather than accepted: a batched simulation fails as a **unit**, so one bad contract id would fail the whole call where N separate calls failed exactly one. On a batch failure this falls back to per-token reads, restoring the original per-item error isolation. The fallback is the slow path and only runs when the fast path could not answer — `fallbackCalls` counts it separately so it stays visible.

## Regression guard

`rpcCalls` is asserted at an exact value (15 trustlines → exactly 1 call, and 0 fallback calls). Any reintroduced per-token read breaks that assertion immediately rather than silently regressing to N+1.

## Run tests

```bash
npx vitest run contrib/examples/issue-216-batched-trustline-balances/batched-trustline-balances.test.ts
```
