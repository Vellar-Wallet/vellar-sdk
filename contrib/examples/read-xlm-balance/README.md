# Read a native XLM balance

Reads a native XLM balance for a given account using `vellar-sdk`'s
RPC-backed balance reader (`createRpcBalanceReader` from the `vellar-sdk/rpc`
subpath), and prints both the raw stroops amount and the formatted XLM
amount.

## Testnet RPC URL used

`TESTNET.rpcUrl` from `src/config.ts`: `https://soroban-testnet.stellar.org`
(SDF's public testnet Soroban RPC). The balance read is a simulated
`balance(id)` contract call — no signature and no fee required.

## Run it

```sh
npx tsx read-balance.ts <accountId>
```

Example:

```sh
npx tsx read-balance.ts GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H
```

Expected output shape:

```
Account:  GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H
Balance:  1250000000 stroops (125 XLM)
```

Requires network access to reach the testnet RPC; the account must exist on
testnet or the simulation call will fail with a clear error.

## Tests

The unit tests inject a mock `BalanceReader` so they don't depend on a live
RPC call:

```sh
npx vitest run contrib/examples/read-xlm-balance
```
