# Installation

## Install the package

```sh
npm install vellar-sdk @stellar/stellar-sdk
# or: pnpm add vellar-sdk @stellar/stellar-sdk
# or: yarn add vellar-sdk @stellar/stellar-sdk
```

`@stellar/stellar-sdk` is a **peer dependency** — you install it alongside so
your app and the SDK share one copy.

You'll also want the passkey smart-wallet engine and Soroban token client the
SDK composes:

```sh
npm install passkey-kit
```

## What you supply

The SDK stays free of a hard dependency on a specific wallet-engine version and
of any secret material. You provide three host pieces:

| Piece | What it is | Why the SDK doesn't own it |
| --- | --- | --- |
| `kit` | A `PasskeyKit` instance | Keeps browser-only WebAuthn code out of SSR and lets you pin the version |
| `sac` | A `SACClient` (Soroban token client) | Used to build token transfers |
| `backend` | Your server endpoints | The relayer/sponsor keys are secrets — they must live server-side, never in the client |

The `backend` object implements three methods:

```ts
interface Backend {
  submitWalletCreation(input): Promise<{ sessionId: string }>;
  lookupContractId(input): Promise<{ contractId: string; sessionId: string } | undefined>;
  submitTransaction(input: { signedXdr: string; network }): Promise<{ hash: string }>;
}
```

These forward to your server, which holds the OpenZeppelin Relayer / sponsor
credentials and submits to the network. See [How It Works](./how-it-works.md)
for why submission is server-side.

> **You don't have to build this backend to get started.** A hosted testnet
> gateway runs at `https://vellar-backend.onrender.com` — point
> `createHttpWalletBackend` at it and skip the server work entirely (this is
> what [hackathon](./hackathon.md#getting-started) projects should do). It
> also serves the policy API for `apiUrl`. Free instance: the first request
> after idle can take 30–60 seconds to wake. Run your own backend when you
> ship to production.

## Requirements

- **A secure context** — WebAuthn (passkeys) only works over HTTPS or
  `localhost`. It will **not** work in embedded/preview browsers.
- **A modern browser** with platform authenticator support (all current
  Chrome / Safari / Edge / Firefox).
- **Node 18+** if you run any of the SDK in a server environment.

Next: the [Quickstart](./quickstart.md).
