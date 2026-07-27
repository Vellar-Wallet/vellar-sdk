# Mock passkey kit for headless testing

A mock `PasskeyKitLike` implementing `createWallet`, `connectWallet`, and
`sign`, each returning a fixed, documented canned response — never a real
WebAuthn ceremony or browser feature. Useful for headless tests that need to
wire a kit into `createVellarWallet()`.

## Canned responses

| Method | Returns |
| --- | --- |
| `createWallet` | `{ keyIdBase64: CANNED_KEY_ID, contractId: CANNED_CONTRACT_ID, signedTx: "mock-signed-deployment-tx" }` |
| `connectWallet` | `{ keyIdBase64: CANNED_KEY_ID, contractId: CANNED_CONTRACT_ID }` |
| `sign` | the input transaction, unchanged (a no-op "signature") |

## Run it

```sh
npx tsx mock-passkey-kit.ts
```

Wires the mock kit (plus a minimal mock backend) into the real
`createVellarWallet()` and calls `create()`, printing the resulting session.

## Tests

```sh
npx vitest run contrib/examples/mock-passkey-kit
```
