# Introduction

**Vellar SDK** (`vellar-sdk`) is the fastest way to add a passkey-powered,
self-custodial Stellar wallet to your app — without handling private keys, seed
phrases, or the low-level submission plumbing.

One install, one object:

```ts
const vela = createVelaWallet({ network, appName, kit, sac, backend, isValidAddress });
await vela.create({ username });        // passkey → smart account
await vela.pay({ to, amount, token });  // simulate → passkey → sponsored submit
```

## What you get

- 🔐 **Passkeys, not seed phrases** — WebAuthn (Face ID / Touch ID / security
  keys). Keys live in the device's secure enclave and never leave it.
- 🪪 **Smart-contract accounts** — each wallet is a Soroban smart wallet, so it
  can carry programmable policies (spending limits, multisig, allowlists).
- ⛽ **Fee-sponsored** — users hold no XLM for fees; submission is sponsored
  server-side.
- 🚫 **No key custody, no silent signing** — the SDK never holds secrets and
  never signs without an explicit passkey prompt.

## Who this is for

Developers building on Stellar who want login + a wallet without becoming
wallet-infrastructure experts — and teams who want programmable, on-chain
security (spending limits, co-signers) instead of client-side checks that can be
bypassed.

## Status

Early and evolving. **Testnet-ready**; mainnet use is pending a security review.
APIs may change before `1.0`.

> New here? Go to [Installation](./installation.md), then the
> [Quickstart](./quickstart.md) to get a working wallet in a few minutes.
