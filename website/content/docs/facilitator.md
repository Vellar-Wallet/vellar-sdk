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
> a minute (cold start). Mainnet is gated on a security review. Source:
> [Vellar-Wallet/vellar-facilitator](https://github.com/Vellar-Wallet/vellar-facilitator).

## Why it exists

Policy-governed smart-account payments (the [x402 agent flow](./x402.md))
run the spending-policy contract inside `__check_auth`, which raises the
simulation-derived fee to roughly 140,000 stroops. Hosted facilitators
default to a 50,000-stroop sponsorship ceiling and reject those payments
with `fee_exceeds_maximum`, even though the payment is valid and
policy-approved. The Vellar facilitator ships with a 2,000,000-stroop
ceiling, so **agent payments bounded by an on-chain budget settle instead of
being refused**. Both classic keypairs and Soroban smart accounts are
supported.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /verify` | Verify a payment by re-simulation (runs the payer's `__check_auth`, including any policy) |
| `POST /settle` | Submit on-chain, fee-sponsored |
| `GET /supported` | Advertised scheme, network, extensions, signer addresses |
| `GET /discovery/resources` | List cataloged x402 resources — filters: `type`, `payTo`, `scheme`, `network`, `extensions`; `limit`/`offset` pagination |
| `GET /discovery/search` | Natural-language search over the catalog — `query`, cursor pagination |
| `GET /health` | Liveness |

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
