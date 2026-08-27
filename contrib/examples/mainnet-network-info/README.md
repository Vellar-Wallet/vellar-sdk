# Mainnet network info

Prints the canonical Stellar mainnet network passphrase and its CAIP-2
identifier. Pure constant lookup — no network calls.

## Where this is used in the SDK

- `MAINNET.networkPassphrase` (`src/config.ts`) is one of the SDK-verified
  fields in the `MAINNET` / `mainnetConfig()` `NetworkConfig` — used to
  construct `PasskeyKit`/`SACClient` and to sign/submit transactions on the
  correct network.
- The `stellar:pubnet` CAIP-2 identifier is how the SDK's x402 client
  (`src/x402-client.ts`) tags mainnet payment requirements per the x402 v2
  spec (`PaymentRequirements.network`, `src/x402-types.ts`).

## Run it

```sh
npx tsx mainnet-network-info.ts
```

Expected output:

```
Network passphrase: Public Global Stellar Network ; September 2015
CAIP-2 identifier:  stellar:pubnet
```

## Tests

```sh
npx vitest run contrib/examples/mainnet-network-info
```
