# x402 Facilitator

Vellar runs a hosted **x402 facilitator for Stellar** with Bazaar discovery:

```
https://vellar-facilitator.onrender.com
```

A facilitator is the verify/settle service between a buyer and a seller in an
x402 payment. The seller's server never touches Soroban directly, and the
buyer never needs XLM: the facilitator re-simulates the signed payment to
verify it, submits it on-chain, and sponsors the network fee.

> **Status: testnet, pre-production.** Open for anyone to build against. It
> runs on a free tier for now, so the first request after idle can take up to
> a minute (cold start) — and the catalog does not survive that sleep (see
> [Limits](#limits-and-operational-caveats)). The pre-mainnet security review
> is complete; mainnet is now gated on a persistent-disk deployment and a
> funded pubnet sponsor account. Source:
> [Vellar-Wallet/vellar-facilitator](https://github.com/Vellar-Wallet/vellar-facilitator).

## Why it exists

Policy-governed smart-account payments (the [x402 agent flow](./x402.md))
run the spending-policy contract inside `__check_auth`, which raises the
simulation-derived fee to roughly 130,000 stroops (worst settlement measured
on testnet: 127,808). Hosted facilitators default to a 50,000-stroop
sponsorship ceiling and reject those payments with `fee_exceeds_maximum`,
even though the payment is valid and policy-approved. The Vellar facilitator
ships with a 500,000-stroop ceiling — ~3.9× the worst real settlement,
raisable via `MAX_TX_FEE_STROOPS` — so **agent payments bounded by an
on-chain budget settle instead of being refused**. Both classic keypairs and
Soroban smart accounts are supported.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /verify` | Verify a payment by re-simulation (runs the payer's `__check_auth`, including any policy) |
| `POST /settle` | Submit on-chain, fee-sponsored |
| `GET /supported` | Advertised scheme, network, extensions, signer addresses |
| `GET /discovery/resources` | List cataloged x402 resources — filters: `type`, `payTo`, `scheme`, `network`, `extensions`, `verified_only`; `limit`/`offset` pagination |
| `GET /discovery/search` | Keyword search over the catalog — token-scored relevance ranking (not semantic); `query` plus the same filters as list, cursor pagination |
| `GET /health` | Liveness; also reports `catalogFrozen` if the catalog has stopped accepting writes |

Wire-compatible with the canonical x402 clients — `HTTPFacilitatorClient`
and the `withBazaar` extension work unmodified.

## For sellers

Point your resource server's facilitator client at the URL and your API
gains x402 payments with no Stellar plumbing:

```ts
import { HTTPFacilitatorClient } from "@x402/core/http";
import { x402ResourceServer } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";

const server = new x402ResourceServer(
  new HTTPFacilitatorClient({ url: "https://vellar-facilitator.onrender.com" }),
).register("stellar:testnet", new ExactStellarScheme());
```

Declare the **bazaar discovery extension** on a route and your resource is
cataloged automatically after its first settled payment — no registration
step — making it findable by agents:

```ts
import { declareDiscoveryExtension, bazaarResourceServerExtension } from "@x402/extensions/bazaar";

server.registerExtension(bazaarResourceServerExtension);
// route config:
//   extensions: declareDiscoveryExtension({
//     input: { topic: "perseverance" },
//     inputSchema: { properties: { topic: { type: "string" } } },
//     output: { example: { quote: "..." } },
//   })
```

Listing metadata is sanitized at ingest (matching the upstream
`@x402/extensions` rules): `serviceName` must be printable ASCII, max 64
chars — a non-ASCII name (non-Latin characters, emoji) is **silently
dropped**, not transliterated — descriptions are clamped to 256 chars, and
tags follow the same ASCII rule.

## For buyers and agents

`vellar-sdk`'s [`wallet.x402.fetch()`](./x402.md) works against any compliant
facilitator the seller chose — nothing to configure on the buyer side. The
difference this facilitator makes: if the paying account carries a
spending-limit policy, the payment **settles** here where other facilitators
reject it on the fee ceiling.

## Discovery (Bazaar)

Agents can find payable resources instead of being hardcoded with URLs. Each
result carries everything needed to call **and** pay: URL, method, input
schema, price, asset, and recipient.

```ts
import { HTTPFacilitatorClient } from "@x402/core/http";
import { withBazaar } from "@x402/extensions/bazaar";

const bazaar = withBazaar(
  new HTTPFacilitatorClient({ url: "https://vellar-facilitator.onrender.com" }),
).extensions.bazaar;

const { items } = await bazaar.listResources({ network: "stellar:testnet" });
const { resources } = await bazaar.search({ query: "weather data api" });
```

For AI agents there is also an **MCP discovery server** exposing
`x402_list_resources` and `x402_search_resources` as tools — see the
[repo README](https://github.com/Vellar-Wallet/vellar-facilitator#mcp-discovery-server-for-ai-agents)
for the client config.

## Trust signals

Each catalog entry's payment options carry a trust block so agents can weigh
a resource before paying:

- `settlements` — count of observed on-chain settlements for this resource.
- `uniquePayers` — how many distinct accounts have paid it.
- `verification` — reads `"verified"` only when the resource's URL ownership
  has been actively verified (`ownerVerified`): the facilitator fetches the
  URL and checks that its 402 challenge advertises the same `payTo` that
  settled.
- `observedSettlements` / `statsSource` — provenance: whether the stats were
  observed live by this process or restored from persistence.

> **Don't build UI on trust badges yet.** On the hosted free-tier instance,
> ownership verification does not survive restarts, so badges currently read
> unverified and `verified_only=true` can return an empty list.

## Limits and operational caveats

Things a developer building against the hosted instance should know up front:

- **The catalog is ephemeral.** The free tier has no persistent disk, so
  catalog entries and URL ownership bindings vanish on every restart or idle
  sleep — cold start doesn't just mean latency, it means data loss. A
  resource is re-cataloged after its next settled payment.
- **URL ownership is trust-on-first-use.** The first settled payment binds a
  resource URL to its `payTo` (then verified against the URL's own 402
  challenge). A different `payTo` settling the same URL is refused from the
  catalog — and on the hosted instance that first-settler race reopens after
  each restart.
- **Rate and size limits.** 60 requests/min per IP; `/verify` and `/settle`
  bodies are capped at 32 KiB.
- **Settlement can be refused.** `/settle` returns
  `503 { error: "settlement_refused", reason }`. `sponsor_balance_low`
  (sponsor under its hard balance floor) refuses on every network. Four
  spend-policy reasons — `rate_limited_payto`, `rate_limited_url`,
  `spend_ceiling`, `unbound_pool_exhausted` — refuse on pubnet; on testnet
  they are logged as would-reject and the settlement proceeds.

## Proven end to end

The full loop is live-verified on testnet with on-chain settlement hashes: a
policy-governed Vellar smart account paid a Bazaar-declared resource through
the hosted facilitator, fees were sponsored by the facilitator's own
account, and the resource became searchable automatically. Details, hashes,
and runnable seller/buyer examples:
[`docs/decisions.md`](https://github.com/Vellar-Wallet/vellar-facilitator/blob/main/docs/decisions.md)
and
[`examples/`](https://github.com/Vellar-Wallet/vellar-facilitator/tree/main/examples)
in the repo.
