# Introduction

> Vellar is an x402 facilitator with Bazaar discovery — a hosted service that
> verifies and settles HTTP 402 payments on Stellar, paired with a catalog so
> AI agents can find and pay for resources without hardcoded URLs.

By the end of this page you will understand what Vellar is, what problem it
solves, and which part of the docs to read next based on what you are building.

## What Vellar is

Vellar is a programmable payment platform for Stellar that lets people and AI
agents discover, pay for, and be governed on services, with the rules enforced
by consensus rather than by your application code. The x402 payment layer
Vellar runs — a live verify/settle facilitator with Bazaar discovery — is live
on Stellar testnet today, reachable straight from a terminal via
[`vellar-cli`](https://www.npmjs.com/package/vellar-cli) or from an AI agent
via the [MCP payer](../agent-tooling/mcp-payer.md). Every settled payment
auto-catalogs its resource so agents can find what to pay for, and a payment
can be governed on-chain by spending-limit and verified-only policies. The
facilitator raises its fee ceiling specifically to accept those
policy-governed payments, which the reference facilitator rejects.

## The components

### x402 facilitator

A live verify/settle facilitator that re-simulates each payment on-chain,
settles the SEP-41 transfer, and sponsors the network fee. People and agents
pay for HTTP-402 resources while holding no XLM themselves, and a seller
points at the facilitator once and charges per request without touching
Soroban RPC, auth entries, or fee handling.

### Bazaar discovery

Every settled payment auto-catalogs its resource, so a service shows up in the
catalog just by getting paid, with no separate registration step. An agent
needs this because it is otherwise hardcoded with URLs: with Bazaar it
searches by keyword and each result carries the exact asset, amount, and
`payTo` it needs to pay. The facilitator also ships an MCP stdio server
exposing the catalog as agent tools, so an AI agent can search for payable
resources without hardcoded URLs.

### CLI and MCP payer

[`vellar-cli`](../agent-tooling/cli.md) discovers, quotes, pays for, and
inspects x402 resources from a terminal — no wallet setup, no browser.
[`vellar-mcp-x402-payer`](../agent-tooling/mcp-payer.md) gives an AI agent the
same capability as an MCP stdio server, holding exactly one key with
process-level and on-chain budget layers so a spending mistake or a
compromised agent still can't exceed what you authorized.

### Agent spending controls

A spending-limit policy caps *how much* an agent can move per fixed window; a
verified-only policy restricts it to contracts whose source has been
reproducibly verified — provenance, not an audit. Both are enforced by Stellar
consensus rather than by your code, so the limits bind even a fully
compromised agent that bypasses your application entirely. See
[Policies](../agent-tooling/policies.md).

### Passkey smart wallet — optional

For apps that want passkey-based smart accounts: WebAuthn onboarding (Face ID
/ Touch ID) backed by Soroban smart-contract accounts, with no seed phrase and
fee-sponsored submission. This is the account layer buyers and agents pay
from, but you don't need it to pay for a Bazaar resource from a script or an
agent — a plain funded keypair works for that. See
[Wallet API Reference](../api-reference.md) if you're building a consumer
wallet.

## Who this is for

**Developers adding payments to an existing endpoint** who want to charge per
request without Stellar plumbing. Point your resource server's facilitator
client at the hosted URL and your API gains x402 payments; declare the bazaar
discovery extension on a route and it is cataloged automatically after its
first settled payment.

**Teams building AI agents that spend money** who need programmable, on-chain
security instead of client-side checks that can be bypassed. An agent holds a
scoped key bounded by a spending-limit policy the chain enforces — give your
agent a budget, not your keys.

**Developers building user-facing apps on Stellar** who want login and a
wallet without becoming wallet-infrastructure experts. Passkey onboarding
replaces seed phrases, deployment and fees are sponsored, and the SDK exposes
one object with `create`, `connect`, and `pay`.

## Status

> ⚠️ **Testnet by default; mainnet exists.** Every tool here defaults to the
> testnet facilitator, and every example in these docs spends test USDC. A
> separate mainnet deployment is live and moves real funds.
>
> One pre-mainnet gate is still open: the spending-limit policy contract has not
> had a mainnet security audit. The facilitator review is complete; the policy
> contract is separate work.
>
> APIs may change before 1.0.

## Where to start

| I want to... | Start here |
|---|---|
| Accept payments on my API | [Charge for an endpoint](../facilitator.md) |
| Have an agent pay for resources | [Pay for a resource](../buyers/pay-for-a-resource.md) and [the CLI](../agent-tooling/cli.md) |
| Run my own facilitator | [Run the facilitator](../operators/run.md) |
| Give my agent a spending budget | [Policies](../agent-tooling/policies.md) |
| Understand how it works | [How it works](./how-it-works.md) |
| Build a passkey wallet for my users | [Wallet API Reference](../api-reference.md) |
