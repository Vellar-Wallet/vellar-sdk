# Introduction

**Vellar SDK** (`vellar-sdk`) is the fastest way to add a passkey-powered,
self-custodial Stellar wallet to your app — without handling private keys, seed
phrases, or the low-level submission plumbing.

One install, one object:

```ts
const vellar = createVellarWallet({ network, appName, kit, sac, backend, isValidAddress });
await vellar.create({ username });        // passkey → smart account
await vellar.pay({ to, amount, token });  // simulate → passkey → sponsored submit
```

## What you get

- **Passkeys, not seed phrases** — WebAuthn (Face ID / Touch ID / security
  keys). Keys live in the device's secure enclave and never leave it.
- **Smart-contract accounts** — each wallet is a Soroban smart wallet, so it
  can carry programmable policies (spending limits, multisig, allowlists).
- **Fee-sponsored** — users hold no XLM for fees; submission is sponsored
  server-side.
- **No key custody, no silent signing** — the SDK never holds secrets and
  never signs without an explicit passkey prompt.
- **Agentic payments (x402)** — pay HTTP-402 resources from the smart account,
  and give an AI agent a scoped key that pays on its own within limits the
  **chain** enforces, not your code. See [x402](./x402.md).

## For the agent economy

Vellar isn't only a human wallet — it's built for autonomous agents that spend
money. Three surfaces make that safe:

- **[Agent keys](./agent-keys.md)** — mint a scoped session key an agent holds
  itself. *Give your agent a budget, not your keys.*
- **[Policies](./policies.md)** — a spending-limit policy caps *how much*; a
  verified-only policy restricts the agent to contracts with reproducible,
  verified source (*provenance, not an audit*). Both are enforced on-chain in
  the wallet's `__check_auth`, so a compromised agent can't exceed them.
- **[x402 Facilitator](./facilitator.md)** — Vellar runs a hosted x402
  verify/settle facilitator with Bazaar discovery, so agents can find and pay
  for services (and it accepts the policy-governed payments other facilitators
  reject).

## Who this is for

Developers building on Stellar who want login + a wallet without becoming
wallet-infrastructure experts, teams who want programmable, on-chain security
(spending limits, co-signers) instead of client-side checks that can be
bypassed, and anyone building AI agents that need to transact under limits
they can trust.

## Status

Early and evolving. **Testnet-ready**; mainnet use is pending a security review.
APIs may change before `1.0`.

> New here? Go to [Installation](./installation.md), then the
> [Quickstart](./quickstart.md) to get a working wallet in a few minutes.
