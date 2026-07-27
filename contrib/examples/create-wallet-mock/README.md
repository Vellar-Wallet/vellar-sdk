# Create a wallet with a mock passkey kit

Calls the real `createVellarWallet()` from the SDK with a small in-file mock
`PasskeyKit` and backend — no real WebAuthn prompt, no network call — and
prints the resulting session's `accountId` and `keyId`.

## How the mock works

- `createMockPasskeyKit()` returns fixed, deterministic identifiers from
  `createWallet()` instead of prompting a real passkey ceremony.
- `createMockBackend()` accepts the deployment and hands back a session id
  without touching a real gateway.

## Run it

```sh
npx tsx create-wallet.ts
```

Expected output:

```
accountId: CMOCKWALLETCONTRACTADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
keyId:     mock-keyid-example-user
```

## Tests

```sh
npx vitest run contrib/examples/create-wallet-mock
```
