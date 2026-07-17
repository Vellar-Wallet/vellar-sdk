# createVellarWallet

The single public entry point. Composes the passkey engine, token client, and
your backend into one wallet handle.

```ts
import { createVellarWallet } from "vellar-sdk";

const vellar = createVellarWallet(config);
```

## Config

```ts
interface VellarWalletConfig {
  network: "testnet" | "mainnet";
  appName: string;
  kit: PasskeyKit;
  sac: SACClient;
  backend: Backend;
  isValidAddress: (address: string) => boolean;
  signedToXdr?: (signed: unknown) => string;
}
```

| Field | Type | Description |
| --- | --- | --- |
| `network` | `"testnet" \| "mainnet"` | Which Stellar network this client operates on. |
| `appName` | `string` | Display name shown in the platform passkey prompt (WebAuthn RP name). |
| `kit` | `PasskeyKit` | The passkey smart-wallet engine. Supplied by you so browser-only code isn't imported during SSR. |
| `sac` | `SACClient` | Soroban token client, used to build payment transfers. |
| `backend` | `Backend` | Your server endpoints for submission and lookup (holds relayer/sponsor secrets — never the SDK). |
| `isValidAddress` | `(address) => boolean` | Validates a recipient before a payment is ever signed. |
| `signedToXdr?` | `(signed) => string` | Advanced/test hook: convert the kit's signed output to XDR. Defaults to handling strings and objects with `toXDR()`. |

## The `backend` contract

```ts
interface Backend {
  submitWalletCreation(input: {
    keyId: string;
    contractId: string;
    network: "testnet" | "mainnet";
    signedTx: unknown;
  }): Promise<{ sessionId: string }>;

  lookupContractId(input: {
    keyId: string;
    network: "testnet" | "mainnet";
  }): Promise<{ contractId: string; sessionId: string } | undefined>;

  submitTransaction(input: {
    signedXdr: string;
    network: "testnet" | "mainnet";
  }): Promise<{ hash: string }>;
}
```

These forward to your server, which holds the relayer/sponsor credentials and
submits to the network. See [Installation](./installation.md) and
[How It Works](./how-it-works.md).

## Returns

A [`VellarWallet`](./wallet-methods.md) handle.
