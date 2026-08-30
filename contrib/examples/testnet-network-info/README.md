# Testnet network info

Prints the canonical Stellar testnet network passphrase and its CAIP-2
identifier. Pure constant lookup — no network calls.

## Where this is used in the SDK

- `TESTNET.networkPassphrase` (`src/config.ts`) is one of the fields in the
  `TESTNET` `NetworkConfig` — used to construct `PasskeyKit`/`SACClient` and
  to sign/submit transactions on the correct network.
- The `stellar:testnet` CAIP-2 identifier is how the SDK's x402 client
  (`src/x402-client.ts`) tags testnet payment requirements per the x402 v2
  spec (`PaymentRequirements.network`, `src/x402-types.ts`).

## Run it

```sh
npx tsx testnet-network-info.ts
```

Expected output:

```
Network passphrase: Test SDF Network ; September 2015
CAIP-2 identifier:  stellar:testnet
```

## Tests

```sh
npx vitest run contrib/examples/testnet-network-info
```
