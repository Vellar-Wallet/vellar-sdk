# Introduction

> Vellar is the payment layer for the agent economy on Stellar — a passkey
> smart wallet, a hosted x402 facilitator with Bazaar discovery, and on-chain
> spending policies in one SDK.

By the end of this page you will understand what Vellar is, what problem it
solves, and which part of the docs to read next based on what you are building.

## What Vellar is

Vellar is a programmable payment platform for Stellar that lets people and AI
agents discover, pay for, and be governed on services, with the rules enforced
by consensus rather than by your application code. The `vellar-sdk` package on
npm is the client half; the x402 payment layer Vellar runs — a live
verify/settle facilitator with Bazaar discovery — is the other half, and it is
live on Stellar testnet today. What separates it from a bare x402 facilitator is
that the wallet and policy layers are Vellar's too: every settled payment
auto-catalogs its resource so agents can find what to pay for, and a payment can
be governed on-chain by spending-limit and verified-only policies that co-sign
inside the wallet's `__check_auth`. The facilitator raises its fee ceiling
specifically to accept those policy-governed payments, which the reference
facilitator rejects.

## The four components

### x402 payments

A live verify/settle facilitator that re-simulates each payment on-chain,
settles the SEP-41 transfer, and sponsors the network fee. People and agents pay
for HTTP-402 resources while holding no XLM themselves, and a seller points at
the facilitator once and charges per request without touching Soroban RPC, auth
entries, or fee handling. For agents this matters because verification
re-simulates the payment — running the account's `__check_auth` — so an
over-budget or wrong-token payment is rejected before it settles.

### Bazaar discovery

Every settled payment auto-catalogs its resource, so a service shows up in the
catalog just by getting paid, with no separate registration step. An agent needs
this because it is otherwise hardcoded with URLs: with Bazaar it searches by
keyword and each result carries the exact asset, amount, and `payTo` it needs to
pay. The facilitator also ships an MCP stdio server exposing the catalog as
agent tools, so an AI agent can search for payable resources without hardcoded
URLs.

### On-chain governance

A spending-limit policy caps *how much* an agent can move per fixed window; a
verified-only policy restricts it to contracts whose source has been reproducibly
verified — provenance, not an audit. Both are checked inside the wallet's
`__check_auth` during authorization, which is what makes them different from
client-side checks: an over-budget or unverified payment is rejected by
consensus and no funds move, so the limits bind even a fully compromised agent
that bypasses your code entirely.

### Passkey smart wallet

WebAuthn onboarding (Face ID / Touch ID) backed by Soroban smart-contract
accounts. The private key is generated in the device's secure enclave and never
leaves it, there is no seed phrase and no key-import path, and submission is
fee-sponsored so the user's wallet needs no XLM. The SDK never holds, imports,
or exports a private key, and every signature requires an explicit passkey
prompt — no silent signing. This is the account layer the rest is built on.

## Who this is for

**Developers building user-facing apps on Stellar** who want login and a wallet
without becoming wallet-infrastructure experts. Passkey onboarding replaces seed
phrases, deployment and fees are sponsored, and the SDK exposes one object with
`create`, `connect`, and `pay`.

**Teams building AI agents that spend money** who need programmable, on-chain
security instead of client-side checks that can be bypassed. An agent holds a
scoped session key it owns itself, bounded by a spending-limit policy the chain
enforces — give your agent a budget, not your keys.

**Developers adding payments to an existing endpoint** who want to charge per
request without Stellar plumbing. Point your resource server's facilitator
client at the hosted URL and your API gains x402 payments; declare the bazaar
discovery extension on a route and it is cataloged automatically after its first
settled payment.

## Status

> ⚠️ **Testnet only.** Vellar is live on stellar:testnet. Mainnet is gated on a
> security review and a persistent-disk deployment. APIs may change before 1.0.

## Where to start

| I want to... | Start here |
|---|---|
| Build a wallet for my users | [Quickstart](./quickstart.md) |
| Pay for x402 resources from code | [Pay for a resource](../buyers/pay-for-a-resource.md) |
| Add a payment gate to my API | [Charge for an endpoint](../sellers/charge-for-an-endpoint.md) |
| Give my agent a budget | [Agent keys](../agent-tooling/agent-keys.md) |
| Understand how it works | [How it works](./how-it-works.md) |
