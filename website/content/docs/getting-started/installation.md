# Installation

> Install the CLI to pay for x402 resources from a terminal, the MCP payer to
> give an AI agent the same capability, or the SDK to build against the
> facilitator from code. Passkey wallet setup, for apps that want one, is a
> separate optional section below.

By the end of this page you will have the tool you need installed — CLI, MCP
payer, or SDK — and know exactly what a passkey wallet setup additionally
requires if you're building one.

## 1. CLI — pay from a terminal

```sh
npm install -g vellar-cli
```

[`vellar-cli`](../agent-tooling/cli.md) gives you four commands — `search`,
`quote`, `pay`, `inspect` — and needs nothing else: no wallet, no browser, just
a funded Stellar secret key when you're ready to pay. See the
[CLI guide](../agent-tooling/cli.md) to get started.

## 2. MCP payer — give an agent the same capability

```sh
npm install vellar-mcp-x402-payer
```

Runs as an MCP stdio server your agent connects to, holding exactly one key
with process-level and on-chain budget layers. See the
[MCP payer guide](../agent-tooling/mcp-payer.md) for the full setup, including
how to scope its spending ceiling.

## 3. SDK — build against the facilitator from code

Install the SDK together with its Stellar peer dependency:

```sh
npm install vellar-sdk @stellar/stellar-sdk
# or: pnpm add vellar-sdk @stellar/stellar-sdk
# or: yarn add vellar-sdk @stellar/stellar-sdk
```

[`vellar-sdk`](https://www.npmjs.com/package/vellar-sdk) is the client
half — the x402 client, payments, and policies. `@stellar/stellar-sdk` is a
peer dependency; install it alongside the SDK so your app and the SDK share
one copy and avoid version conflicts.

## Requirements

- **Node 18+** for the CLI, MCP payer, or any server-side use of the SDK.

## When it fails

| Symptom | Cause | Fix |
|---|---|---|
| Peer dependency warnings | Multiple copies of stellar-sdk | Install @stellar/stellar-sdk explicitly in your project |
| `TypeError: Invalid URL` during x402.fetch | rpcUrl missing from x402 config | Add `x402.rpcUrl: "https://soroban-testnet.stellar.org"` |

## Building a passkey wallet (optional)

Everything above works from a plain funded keypair. If you're building a
consumer-facing app and want passkey-based smart accounts instead, you'll also
need the passkey smart-wallet engine and Soroban token client the SDK
composes:

```sh
npm install passkey-kit
```

`passkey-kit` supplies both `PasskeyKit` (the WebAuthn smart-wallet engine) and
`SACClient` (the Soroban token client used to build transfers).

### What you supply

The SDK has no hard dependency on a specific wallet engine version and holds no
secret material. You provide three pieces:

| Piece | What it is | Why the SDK doesn't own it |
| --- | --- | --- |
| `kit` | A `PasskeyKit` instance | Keeps browser-only WebAuthn code out of SSR and lets you pin the version |
| `sac` | A `SACClient` (Soroban token client) | Used to build token transfers |
| `backend` | Your server endpoints | The relayer/sponsor keys are secrets — they must live server-side, never in the client |

### The backend interface

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
> testnet gateway at `https://vellar-backend-production.up.railway.app` handles wallet
> creation, lookup, and transaction submission. Use it for development and
> hackathon projects. Run your own backend before shipping to production — it is
> three routes that hold your relayer and sponsor credentials.

### Additional requirements for a passkey wallet

- **A secure context** — WebAuthn (passkeys) only works over HTTPS or
  `localhost`, and will **not** work in embedded or preview browsers.
- **A modern browser** with platform authenticator support, which covers all
  current Chrome, Safari, Edge, and Firefox releases.

### When it fails

| Symptom | Cause | Fix |
|---|---|---|
| WebAuthn not working | Not served over HTTPS or localhost | Use HTTPS in development (ngrok, Caddy, etc.) |
| WebAuthn not working | Embedded or preview browser | Test in a full browser — Chrome, Safari, Firefox, Edge |

See [Wallet API Reference](../api-reference.md) for the full `createVellarWallet`
config.

## Next steps

- [Quickstart](./quickstart.md) — search the Bazaar and pay for a resource in
  under two minutes
- [How it works](./how-it-works.md) — the payment loop, step by step
- [Wallet API Reference](../api-reference.md) — the full createVellarWallet config
