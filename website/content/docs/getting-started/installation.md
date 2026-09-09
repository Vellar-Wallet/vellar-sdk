# Installation

> Install vellar-sdk and its peer dependencies, understand what your backend
> must supply, and confirm your environment meets the requirements.

By the end of this page you will have the SDK installed, know exactly what three
pieces your application must provide, and understand why the backend exists.

## 1. Install the packages

Install the SDK together with its Stellar peer dependency:

```sh
npm install vellar-sdk @stellar/stellar-sdk
# or: pnpm add vellar-sdk @stellar/stellar-sdk
# or: yarn add vellar-sdk @stellar/stellar-sdk
```

`vellar-sdk` is the client half — the wallet handle, payments, policies, and the
x402 client. `@stellar/stellar-sdk` provides the Stellar primitives the SDK
builds transactions with.

You will also want the passkey smart-wallet engine and Soroban token client the
SDK composes:

```sh
npm install passkey-kit
```

`passkey-kit` supplies both `PasskeyKit` (the WebAuthn smart-wallet engine) and
`SACClient` (the Soroban token client used to build transfers).

> **Note:** `@stellar/stellar-sdk` is a peer dependency. Install it alongside
> the SDK so your app and the SDK share one copy and avoid version conflicts.

## 2. What you supply

The SDK has no hard dependency on a specific wallet engine version and holds no
secret material. You provide three pieces:

| Piece | What it is | Why the SDK doesn't own it |
| --- | --- | --- |
| `kit` | A `PasskeyKit` instance | Keeps browser-only WebAuthn code out of SSR and lets you pin the version |
| `sac` | A `SACClient` (Soroban token client) | Used to build token transfers |
| `backend` | Your server endpoints | The relayer/sponsor keys are secrets — they must live server-side, never in the client |

## 3. The backend interface

Your backend implements three methods:

```ts
interface Backend {
  submitWalletCreation(input): Promise<{ sessionId: string }>;
  lookupContractId(input): Promise<{ contractId: string; sessionId: string } | undefined>;
  submitTransaction(input: { signedXdr: string; network }): Promise<{ hash: string }>;
}
```

`submitWalletCreation` submits the smart-account deployment and returns a server
session id. `lookupContractId` resolves a stored passkey credential id back to
its smart-account address so a returning user can reconnect. `submitTransaction`
takes signed XDR and performs the fee-sponsored submit, returning the network
transaction hash.

These forward to your server, which holds the OpenZeppelin Relayer and sponsor
credentials and submits to the network.

> **Note:** You do not have to build this backend to get started. The hosted
> testnet gateway at `https://vellar-backend.onrender.com` handles wallet
> creation, lookup, and transaction submission. Use it for development and
> hackathon projects. Run your own backend before shipping to production — it is
> three routes that hold your relayer and sponsor credentials.

> ⚠️ **Free tier cold start.** The hosted backend runs on a free Render instance
> that sleeps after 15 minutes of inactivity. The first request after idle can
> take 30-90 seconds, occasionally up to 2 minutes. Retry rather than assuming a
> bug. Send a warming request before showing it to a user.

## Requirements

- **A secure context** — WebAuthn (passkeys) only works over HTTPS or
  `localhost`, and will **not** work in embedded or preview browsers.
- **A modern browser** with platform authenticator support, which covers all
  current Chrome, Safari, Edge, and Firefox releases.
- **Node 18+** if you run any of the SDK in a server environment.

## When it fails

| Symptom | Cause | Fix |
|---|---|---|
| WebAuthn not working | Not served over HTTPS or localhost | Use HTTPS in development (ngrok, Caddy, etc.) |
| WebAuthn not working | Embedded or preview browser | Test in a full browser — Chrome, Safari, Firefox, Edge |
| Peer dependency warnings | Multiple copies of stellar-sdk | Install @stellar/stellar-sdk explicitly in your project |
| `TypeError: Invalid URL` during x402.fetch | rpcUrl missing from x402 config | Add `x402.rpcUrl: "https://soroban-testnet.stellar.org"` |

## Next steps

- [Quickstart](./quickstart.md) — create a wallet and send a payment
- [How it works](./how-it-works.md) — why submission goes through your backend
- [API reference](../api-reference.md) — the full createVellarWallet config
