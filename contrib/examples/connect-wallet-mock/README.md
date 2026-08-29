# Connect to an existing wallet by keyId (mock)

Demonstrates the `connect()` flow shape: look up a wallet's `contractId` from
its passkey `keyId` via a backend, without a real WebAuthn prompt or network
call. Uses a small in-file `MockWalletBackend` seeded with one known `keyId`.

## What it shows

- A known `keyId` resolves to a session (`{ accountId, keyId, connected }`).
- An unknown `keyId` produces a clear, catchable error instead of a raw
  `undefined` or an unhandled crash.

## Run it

```sh
npx tsx connect-wallet.ts
```

Expected output:

```
Connected: {
  accountId: 'CABC123KNOWNWALLETCONTRACTADDRESSXXXXXXXXXXXXXXXXXXXXXXXX',
  keyId: 'keyid-known-abc123',
  connected: true
}
Could not connect: connectWallet: no wallet is registered for keyId "keyid-unknown-does-not-exist"
```

## Tests

```sh
npx vitest run contrib/examples/connect-wallet-mock
```
