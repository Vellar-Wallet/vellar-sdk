# Read a SEP-41 token balance

Reads a SEP-41 token balance for a given account and token contract id,
using `vellar-sdk`'s RPC-backed balance reader (`createRpcBalanceReader`,
`vellar-sdk/rpc`). Prints the balance in raw base units — this script
doesn't assume any particular decimals, unlike `read-xlm-balance` which
formats specifically for XLM's 7 decimals.

## Finding a testnet token contract id

Stellar Laboratory's testnet asset explorer, or the Stellar testnet Friendbot
issuers used by common SDF sample tokens, are the usual sources for a
testnet SAC (Stellar Asset Contract) id to test against. The SAC id is
deterministic from the asset code + issuer + network passphrase — a wallet's
own `nativeToken()` helper (`src/balances-rpc.ts`) shows the same derivation
for the native asset.

## Run it

```sh
npx tsx read-token-balance.ts <accountId> <tokenContractId>
```

## Tests

Injects a mock `BalanceReader`, so the tests don't depend on a live RPC call:

```sh
npx vitest run contrib/examples/read-token-balance
```
