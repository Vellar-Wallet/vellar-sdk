# Discover Services

> Search the Vellar Bazaar to find x402 resources by what they do, not by their
> URL — then pay the best match directly from the search result.

By the end of this page you will be able to search the Bazaar, read what a
catalog entry tells you before paying, filter by trust signals, and use the MCP
server to give an AI agent the same capability.

## Prerequisites

- The x402 extensions package: `npm install @x402/extensions`
- The Vellar facilitator URL: `https://vellar-facilitator.onrender.com`

## 1. Search the catalog

Each result carries everything needed to call **and** pay: URL, method, input
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

> ⚠️ **The response keys are different for browse and search.** Browse
> (`listResources`) returns results under `items`. Search returns results under
> `resources`. Parsing a search response as `items` returns nothing with no
> error.

> **Note:** Search is hybrid: a lexical arm and a semantic arm fused by
> Reciprocal Rank Fusion. Keyword queries are handled by the lexical stage.
> Queries sharing no vocabulary with any listing are handled by the semantic
> stage and still return results. See [Search and
> Retrieval](../architecture/search-and-retrieval.md) for the full pipeline and
> measured quality figures.

## 2. Read a result before paying

Each result carries everything needed to call and pay an endpoint you have never
seen:

| Field | What it tells you |
|---|---|
| `settlements` | How many on-chain settlements this resource has had |
| `uniquePayers` | How many distinct accounts have paid it |
| `ownerVerified` | Whether the facilitator confirmed this payTo owns this URL |
| `verification` | Always "unknown" — do not filter on this field |
| Payment options | The exact asset, amount, and payTo to pay |

> ⚠️ **Do not use `verified_only=true`.** The `verification` field is always
> `"unknown"` on every deployment, because it reads from an external attestation
> service that is deployed nowhere. The filter is refused outright with
> `400 { "error": "verified_only_unavailable", "reason":
> "no_verdict_source_configured" }`. Use `ownerVerified` instead, which the
> facilitator computes itself with no external dependency.

> **Note:** `ownerVerified` is lost on every restart of the free-tier instance
> (no persistent disk). It self-heals — the next settlement re-runs the check
> after a 15-minute cooldown, with no operator involved. Do not treat a false
> value as permanent.

## 3. Pay the best match

Once you have a result, pay it directly with `wallet.x402.fetch()` using the URL
from the search result:

```ts
const { resources } = await bazaar.search({
  query: "weather data for a city"
});

const best = resources[0];

const { response, paid, settlement } =
  await vellar.x402.fetch(best.url, {
    maxAmount: 1_000_000n,
  });
```

> **Note:** `discoverAndPay` in one call is not a built-in SDK function. Search
> first, then pay the result you choose.

## 4. Use the MCP discovery server

The facilitator ships `vellar-facilitator-discovery`, an MCP stdio server
exposing Bazaar as agent tools, so an AI agent can search for payable resources
without hardcoded URLs.

```json
{
  "mcpServers": {
    "vellar-x402-discovery": {
      "command": "npx",
      "args": ["tsx", "src/mcp.ts"],
      "cwd": "/path/to/vellar-facilitator",
      "env": {
        "FACILITATOR_URL": "https://vellar-facilitator.onrender.com"
      }
    }
  }
}
```

**`x402_list_resources`** — list cataloged resources. Parameters: `type`
(`http` | `mcp`), `payTo`, `network`, `limit` (1–100), `verified_only`,
`offset`.

**`x402_search_resources`** — keyword search. Parameters: `query` (required),
the same filters, and `cursor` for pagination.

> ⚠️ **The MCP server only discovers. It does not pay.** Paying requires a
> separate server that holds a key — see the [MCP payer](../agent-tooling/mcp-payer.md).

> ⚠️ **First tool call after idle takes roughly 45 seconds.** The facilitator
> runs on a free tier. Send a warming `GET /health` request (it is
> rate-limit-exempt) before your agent's first call.

## When it fails

| Error | Cause | Fix |
|---|---|---|
| 400 `verified_only_unavailable` | Using verified_only=true filter | Remove the filter and use ownerVerified field instead |
| 400 on search with empty query | query parameter is required | Pass a non-empty query string |
| Search returns items not resources | Parsing browse response as search | Browse returns items, search returns resources |
| ownerVerified false on known resource | Free-tier restart cleared ownership data | It self-heals after next settlement — wait or trigger a payment |
| MCP first call times out | Facilitator cold start | Send GET /health first with 120s timeout, then retry |

## Next steps

- [Pay for a resource](./pay-for-a-resource.md) — pay once you have a URL
- [Spend controls](./spend-controls.md) — cap what an agent can spend
- [MCP payer](../agent-tooling/mcp-payer.md) — pay from inside an agent runtime
- [Facilitator & Bazaar](../facilitator.md) — list your own resource in the
  catalog
