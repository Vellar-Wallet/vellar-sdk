# Mock SAC client for balance reads

A mock `BalanceReader` (`src/balances.ts`) — the interface the SDK's real
RPC-backed SAC balance reads (`createRpcBalanceReader`, `vellar-sdk/rpc`)
implement — returning a fixed, configurable balance for any token/account
pair. Useful for offline tests that need a balance reader without a real RPC
call.

## Run it

```sh
npx tsx mock-sac-client.ts
```

Expected output (all three accounts get the same fixed balance):

```
GALICE: 500000000 (fixed, regardless of token or account)
GBOB: 500000000 (fixed, regardless of token or account)
CCONTRACTHOLDERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX: 500000000 (fixed, regardless of token or account)
```

## Tests

Also demonstrates wiring the mock into the real `createBalanceService`:

```sh
npx vitest run contrib/examples/mock-sac-client
```
