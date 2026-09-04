# Generate a random ed25519 session key pair

Generates a random ed25519 keypair suitable for use as an x402 session key
signer (`createSessionKeySigner` from `vellar-sdk`), and prints both the
public key and the secret key.

> ⚠️ **Testnet only.** The keypair printed by this script is generated fresh
> on every run and holds no funds. Never fund a key generated this way on
> mainnet, and never reuse a printed secret for anything real — treat every
> run's output as disposable.

## Using the keypair with createSessionKeySigner

`createSessionKeySigner` (from `vellar-sdk`'s `src/x402-signer.ts`) takes the
secret key plus the smart-account C-address it's authorized to sign for:

```ts
import { createSessionKeySigner } from "vellar-sdk";

const signer = createSessionKeySigner({
  address: "C...", // the wallet's smart-account contract id
  secretKey: "S...", // the secret key this script printed
});
```

The session key's spending authority is bounded on-chain by the
spending-limit policy attached to it — this script only generates the raw
keypair, it does not attach any policy.

## Run it

```sh
npx tsx generate-session-key.ts
```

## Tests

```sh
npx vitest run contrib/examples/generate-session-key
```
