# vellar-sdk

**Passkey smart-wallet SDK for Stellar.** Add passkey login, a Soroban smart
account, and fee-sponsored payments to your app — without handling private keys,
seed phrases, or the low-level submission plumbing.

- 🔐 **Passkeys, not seed phrases** — WebAuthn (Face ID / Touch ID / security
  keys). Keys live in the device's secure enclave and never leave it.
- 🪪 **Smart-contract accounts** — each wallet is a Soroban smart wallet, so it
  can carry programmable policies (spending limits, multisig, allowlists).
- ⛽ **Fee-sponsored** — users hold no XLM for fees; submission is sponsored
  server-side.
- 🚫 **No key custody, no silent signing** — the SDK never holds secrets and
  never signs without an explicit passkey prompt.

> Status: early. Testnet-ready; mainnet use pending a security review. APIs may
> change before `1.0`.

## Install

```sh
npm install vellar-sdk @stellar/stellar-sdk
```

## Quick start

You supply three host pieces — a `PasskeyKit` engine, your backend (which holds
the relayer/sponsor keys server-side), and a Soroban token client — and the SDK
composes them into one wallet handle.

```ts
import { PasskeyKit, SACClient } from "passkey-kit";
import { createVellarWallet } from "vellar-sdk";
import { StrKey } from "@stellar/stellar-sdk";

const vela = createVellarWallet({
  network: "testnet",
  appName: "My App",
  kit: new PasskeyKit({ rpcUrl, networkPassphrase, walletWasmHash }),
  sac: new SACClient({ rpcUrl, networkPassphrase }),
  backend: myBackend, // implements submitWalletCreation / lookupContractId / submitTransaction
  isValidAddress: (a) => StrKey.isValidEd25519PublicKey(a) || StrKey.isValidContract(a),
});

// Create a wallet (prompts the passkey once):
const session = await vela.create({ username: "alice" });
console.log(session.accountId); // C... smart-account address

// …or reconnect an existing one:
await vela.connect();

// Send a payment — builds + simulates, then prompts the passkey to sign:
const { hash } = await vela.pay({
  to: "CDEST...",
  amount: 5_0000000n, // 5 XLM, in stroops
  token: { contractId: nativeTokenId, symbol: "XLM", decimals: 7 },
});
```

`pay()` simulates **before** the passkey prompt, so failures (e.g. insufficient
balance) surface without asking the user to sign.

## API

### `createVellarWallet(config): VellarWallet`

Returns a `VellarWallet`:

| Member | Description |
| --- | --- |
| `session` | The current `WalletSession`, or `null` before create/connect |
| `create({ username? })` | Register a passkey and create the smart account |
| `connect()` | Reconnect with an existing passkey |
| `pay({ to, amount, token })` | Build → simulate → sign → submit; returns `{ hash }` |
| `connector` / `payments` | Lower-level building blocks for custom flows |

### Advanced

The facade is the paved road. For custom flows the package also exports the
underlying pieces: `createPasskeyKitConnector`, `createPaymentClient`,
`createSessionStore`, the `WalletConnector` interface, balances helpers
(`vellar-sdk/balances`), and RPC-backed readers (`vellar-sdk/rpc`,
imported separately so `@stellar/stellar-sdk` stays out of bundles that don't
read balances).

## License

Apache-2.0
