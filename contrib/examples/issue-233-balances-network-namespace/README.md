# Per-network cache namespace for balances-rpc (#233)

Self-contained reference for issue [#233](https://github.com/Vellar-Wallet/vellar-sdk/issues/233): `balances-rpc.ts`'s balance cache should be namespaced by network, so a consumer switching between testnet and mainnet never serves a cached balance from the wrong network for the same token contract / holder pair.

## Composite key format

```
<network>|<tokenContractId>|<holder>
```

`|` is used as the separator because it cannot appear in a Stellar network passphrase, contract ID, or strkey — no escaping is needed for any field.

## Migration

`clearUnscopedBalanceEntries(store, knownNetworks)` removes any legacy, pre-#233 entry that doesn't match the `<network>|...` shape for one of the caller's known networks. A legacy entry's original network can't be inferred from a bare `<tokenContractId>|<holder>` key, so it's deleted rather than guessed at — the next balance read repopulates it correctly under a namespaced key.

## Run tests

```bash
npx vitest run contrib/examples/issue-233-balances-network-namespace/balances-network-namespace.test.ts
```
