# Mock wallet backend for offline testing

A mock `WalletBackend` implementing `submitWalletCreation`, `lookupContractId`,
and `submitTransaction`, each returning a fixed, documented canned response
instead of a real network call — useful for offline tests that need to wire
a backend into `createVellarWallet()`.

## Canned responses

| Method | Returns |
| --- | --- |
| `submitWalletCreation` | `{ sessionId: CANNED_SESSION_ID }` |
| `lookupContractId` | `{ contractId: CANNED_CONTRACT_ID, sessionId: CANNED_SESSION_ID }` |
| `submitTransaction` | `{ hash: CANNED_TX_HASH }` |

## Run it

```sh
npx tsx mock-wallet-backend.ts
```

Wires the mock backend (plus a minimal mock passkey kit) into the real
`createVellarWallet()` and calls `create()`, printing the resulting session.

## Tests

```sh
npx vitest run contrib/examples/mock-wallet-backend
```
