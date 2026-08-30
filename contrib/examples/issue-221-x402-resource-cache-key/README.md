# x402 Resource Cache Key (network-scoped)

Self-contained reference for issue [#221](https://github.com/Vellar-Wallet/vellar-sdk/issues/221): compose the network identifier into the x402 resource cache key so multi-network consumers cannot serve a testnet resource record for a mainnet lookup.

## Composite key format

```
v2|<network>|<resourceId>
```

| Field | Meaning |
| --- | --- |
| `v2` | Key-schema version. A key without this prefix predates network scoping and is discarded by the migration. |
| `<network>` | CAIP-2 chain id / SDK network name the lookup resolved against (`stellar:testnet`, `stellar:pubnet`). |
| `<resourceId>` | Resource identifier as supplied by the caller. |

`|` is the separator because it cannot appear in a CAIP-2 chain id. Field order is fixed so `v2|<network>|` works as a prefix for range operations such as `invalidateNetwork()`.

## Migration

`clearUnscopedEntries(store)` drops every entry that lacks the current version prefix. A legacy entry is keyed by the bare resource id, so its network cannot be inferred — it is deleted rather than rewritten, and the next lookup repopulates it under the correct scoped key. `createNetworkScopedResourceCache` runs this once at construction and reports the count as `migratedEntries`.

## Run tests

```bash
npx vitest run contrib/examples/issue-221-x402-resource-cache-key/x402-resource-cache-key.test.ts
```
