# Introduction

**Vellar is a programmable payment platform for Stellar** — the payment layer
for the agent economy. It combines a live [x402 facilitator with Bazaar
discovery](./facilitator.md), on-chain [spending and provenance
policies](./policies.md), and a passkey [smart wallet](./how-it-works.md), so
that people and AI agents can **discover**, **pay for**, and be **governed on**
services on Stellar — with the rules enforced by consensus, not by your code.

The `vellar-sdk` on npm is the client half; the [x402 stack](#the-x402-stack)
Vellar runs is the other half. It's live on Stellar testnet today.

One install, one object:

```ts
const vellar = createVellarWallet({ network, appName, kit, sac, backend, isValidAddress });
await vellar.create({ username });        // passkey → smart account
await vellar.pay({ to, amount, token });  // simulate → passkey → sponsored submit
```

## The four pillars

- **[x402 payments](./x402.md)** — a live verify/settle facilitator that
  re-simulates each payment on-chain, settles the SEP-41 transfer, and
  **sponsors the fee**. People and agents pay for HTTP-402 resources; buyers
  hold no XLM.
- **[Bazaar discovery](./facilitator.md)** — every settled payment auto-catalogs
  its resource, so an agent can **find** what to pay for by searching in plain
  language over HTTP or an MCP server. This is the piece a bare facilitator
  doesn't have.
- **[On-chain governance](./policies.md)** — spending-limit and verified-only
  policies co-sign inside the wallet's `__check_auth`, so an over-budget or
  unverified payment is **rejected by consensus** and no funds move. *Provenance
  the chain enforces, not a claim in a doc.*
- **[Passkey smart wallet](./how-it-works.md)** — WebAuthn onboarding (Face ID /
  Touch ID), Soroban smart-contract accounts, fee-sponsored submission, no key
  custody, no silent signing. The account layer the rest is built on.

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

## The x402 stack

The SDK is the client half. The other half is the **x402 payment layer** Vellar
runs and the SDK talks to — the piece that actually moves money between people,
agents, and the services they pay. It's live on Stellar testnet today.

- **Facilitator (verify & settle)** — when a payment arrives, the facilitator
  re-simulates it against the chain first (running the buyer's Soroban auth
  entry to confirm it would succeed), then settles the SEP-41 transfer and
  **sponsors the fee** from its own account. Buyers hold no XLM; a seller points
  at the facilitator once and charges per request without touching Soroban RPC,
  auth entries, or fee handling.
- **[Bazaar discovery](./facilitator.md)** — every settled payment auto-catalogs
  its resource, so services show up just by getting paid, with no separate
  registration. An agent searches the catalog in plain language over HTTP or
  through an **MCP server**, and each result carries the exact asset, amount, and
  `payTo` it needs to pay. *This is how an agent finds what to pay for in the
  first place.*
- **Policy-governed payments** — because the wallet and policy layers are
  Vellar's too, a payment can be governed on-chain: the spending-limit and
  verified-only policies co-sign inside `__check_auth`, so an over-budget or
  unverified payment is **rejected by consensus** and no funds move. The
  facilitator raises its fee ceiling to accept these, where the reference
  facilitator rejects them.

Together that's the full loop: an agent **discovers** a service in Bazaar,
**pays** through the facilitator under a budget the chain enforces, and can only
pay code whose source is **verified** — none of which your application code has
to police. See [x402](./x402.md) and the [Facilitator](./facilitator.md) guide.

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
