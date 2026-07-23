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

You supply three host pieces — a `PasskeyKit` engine, a Soroban token client,
and **your backend** — and the SDK composes them into one wallet handle. The SDK
ships the network config (`TESTNET`) and an HTTP backend client
(`createHttpWalletBackend`), so there's nothing to hand-wire.

```ts
import { PasskeyKit, SACClient } from "passkey-kit";
import {
  createVellarWallet,
  createHttpWalletBackend,
  TESTNET,
} from "vellar-sdk";
import { StrKey } from "@stellar/stellar-sdk";

const vellar = createVellarWallet({
  network: "testnet",
  appName: "My App",
  kit: new PasskeyKit({
    rpcUrl: TESTNET.rpcUrl,
    networkPassphrase: TESTNET.networkPassphrase,
    walletWasmHash: TESTNET.walletWasmHash,
  }),
  sac: new SACClient({
    rpcUrl: TESTNET.rpcUrl,
    networkPassphrase: TESTNET.networkPassphrase,
  }),
  // Point this at YOUR backend (see "Your backend" below). It holds the
  // relayer/sponsor secrets — the SDK never sees them.
  backend: createHttpWalletBackend("https://api.myapp.com"),
  isValidAddress: (a) =>
    StrKey.isValidEd25519PublicKey(a) || StrKey.isValidContract(a),
});

// Create a wallet (prompts the passkey once):
const session = await vellar.create({ username: "alice" });
console.log(session.accountId); // C... smart-account address

// …or reconnect an existing one:
await vellar.connect();

// Send a payment — builds + simulates, then prompts the passkey to sign:
const { hash } = await vellar.pay({
  to: "CDEST...",
  amount: 5_0000000n, // 5 XLM, in stroops
  token: {
    contractId: TESTNET.nativeTokenContractId, // XLM
    symbol: "XLM",
    decimals: 7,
  },
});
```

`pay()` simulates **before** the passkey prompt, so failures (e.g. insufficient
balance) surface without asking the user to sign.

## Your backend

Submission is fee-sponsored, which requires an OpenZeppelin Relayer API key and
a funded sponsor account. **These are secrets — they must live on your server,
never in the browser.** So the SDK never submits directly: it hands signed
transactions to your backend, which does the sponsored submit.

`createHttpWalletBackend(apiUrl)` speaks to a gateway exposing three routes:

| Route                  | Purpose                                        |
| ---------------------- | ---------------------------------------------- |
| `POST /wallet/create`  | Submit the deployment tx; store keyId→contract |
| `POST /wallet/connect` | Resolve the smart-account for a known passkey  |
| `POST /wallet/submit`  | Submit an already-signed transaction           |

You run a backend implementing these (holding your relayer/sponsor creds). Your
backend must also allow your app's origin via CORS.

## API

### `createVellarWallet(config): VellarWallet`

Returns a `VellarWallet`:

| Member                       | Description                                                  |
| ---------------------------- | ------------------------------------------------------------ |
| `session`                    | The current `WalletSession`, or `null` before create/connect |
| `create({ username? })`      | Register a passkey and create the smart account              |
| `connect()`                  | Reconnect with an existing passkey                           |
| `pay({ to, amount, token })` | Build → simulate → sign → submit; returns `{ hash }`         |
| `policies`                   | Programmable account policies — see [Policies](#policies)   |
| `connector` / `payments`     | Lower-level building blocks for custom flows                 |

### Helpers

| Export                         | Description                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `createHttpWalletBackend(url)` | An HTTP `backend` client for your gateway — pass straight to the config                  |
| `TESTNET`                      | Testnet config: `rpcUrl`, `networkPassphrase`, `walletWasmHash`, `nativeTokenContractId` |
| `WalletApiError`               | Thrown by the HTTP backend on non-2xx responses (has `status`, `code`)                   |

### Policies

Attach programmable policies (e.g. an on-chain spending limit) to a wallet.
Pass `apiUrl` (your policy API gateway) in the config to enable
`wallet.policies`:

```ts
const templates = await vellar.policies.listTemplates();
const policy = await vellar.policies.generate(definition); // validate + artifacts
await vellar.policies.simulate(policy.id); // dry-run, no submit
const { contractId } = await vellar.policies.deploy(policy.id); // ONE passkey prompt
```

`deploy()` runs the full attach: your backend deploys the per-user policy
contract instance (sponsor-funded, server-side), the user passkey-signs
`addPolicy` to attach it — the only WebAuthn prompt, no silent signing — and
the completed attach is recorded. It requires a `policyAttach` runtime in the
config wired to your kit (`addPolicy` → sign → submit); without it, read,
generate, and simulate still work and `deploy()` throws a clear error.

Your gateway must expose the policy routes (`/policies/templates`,
`/policies/validate`, `/policies/generate`, `/policies/:id/simulate`,
`/policies/:id/deploy-instance`, `/policies/deploy`) — instance deploys are
funded by **your** sponsor account, server-side.

### Advanced

The facade is the paved road. For custom flows the package also exports the
underlying pieces: `createPasskeyKitConnector`, `createPaymentClient`,
`createSessionStore`, the `WalletConnector` interface, balances helpers
(`vellar-sdk/balances`), and RPC-backed readers (`vellar-sdk/rpc`,
imported separately so `@stellar/stellar-sdk` stays out of bundles that don't
read balances).

## License

Apache-2.0
