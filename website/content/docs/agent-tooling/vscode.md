# VS Code Extension

> Add an x402 payment gate to an HTTP route without leaving your editor, then make the route findable by AI agents through Bazaar discovery.

By the end of this page you will have the **Vellar x402** extension installed, a payment gate added to a route in your own server, Bazaar discovery declared so agents can find your endpoint, and your first payment verified as cataloged and `ownerVerified`.

## Prerequisites

- **VS Code** with the Extensions panel available.
- **An existing HTTP server** written in Express, Fastify, or the Next.js App Router. The extension gates a route you already have; it does not scaffold a server for you.
- **Node 18 or later.**
- **A Stellar account to be paid into** (your `payTo`), with a trustline to the payment asset.
- **`curl` and `python3`** for the verification steps near the end.

## The full journey

The extension covers the first step. The rest of this page covers the rest, because an injected gate on a route nobody can find earns nothing.

```
install extension
  -> add the payment gate to your route
  -> deploy with a public https URL
  -> first payment settles
  -> Bazaar auto-catalogs the endpoint
  -> ownerVerified becomes true so agents trust it
  -> agents discover and pay you
```

## 1. Install the extension

Search **Vellar x402** in the VS Code Extensions panel, or install from the command line:

```sh
code --install-extension VellarWallet.vellar-x402
```

[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=VellarWallet.vellar-x402)

## 2. Add a payment gate to a route

Open a file containing route definitions, then run this entry from the command palette:

```
Vellar: Add x402 payment to this endpoint
```

The extension:

1. Scans the open file for route definitions.
2. Lets you pick a route.
3. Asks how much to charge in USDC.
4. Injects working boilerplate that:
   - returns a 402 challenge for unpaid requests,
   - verifies and settles via the Vellar facilitator,
   - reads your payout address from VS Code settings.

Your existing route logic is untouched. The payment gate wraps the handler rather than replacing it, so the body you already wrote runs unchanged once a payment settles.

## 3. What gets injected

The extension wires `@x402/stellar`'s `ExactStellarScheme` and points it at the Vellar facilitator (`https://vellar-facilitator.onrender.com`). Your `payTo` address comes from VS Code settings rather than being hardcoded in the file.

The wiring it puts in place looks like this:

```ts
import { HTTPFacilitatorClient } from "@x402/core/http";
import { x402ResourceServer } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";

// A resource server pointed at the hosted Vellar facilitator, with the
// exact scheme registered for stellar:testnet.
const server = new x402ResourceServer(
  new HTTPFacilitatorClient({ url: "https://vellar-facilitator.onrender.com" }),
).register("stellar:testnet", new ExactStellarScheme());
```

The extension then applies that resource server to the route you picked, filling in the price you entered and the `payTo` address from your VS Code settings.

> **Note:** The injected code is the same boilerplate you would write by hand following the [seller guide](../facilitator.md). It is ordinary source in your repo, so edit, refactor, or move it like any other code. You do need to install the packages it imports: `npm install @x402/core @x402/stellar`.

The facilitator advertises `stellar:testnet` only, and it sponsors the Stellar network fee from its own account (`areFeesSponsored: true`), so buyers paying your route need no XLM.

> ⚠️ **The hosted facilitator sleeps.** It runs on a free tier that sleeps after 15 minutes idle, so the first call after a quiet period can take 30 to 90 seconds, occasionally up to 2 minutes. That is a cold start, not a failure. Give the first request a generous timeout before you start debugging the injected code.

## Supported frameworks

| Framework | Support |
| --- | --- |
| Express | Full |
| Fastify | Full |
| Next.js App Router | Full |
| Next.js Pages Router | Detected, not injected |

A Pages Router route is recognised and reported, but the extension will not write the gate for you. Wire it by hand using the same wiring shown above.

## 4. Check your trustline

The `payTo` address you set in VS Code settings needs a trustline to the payment asset before it can accept anything. Without one, a payment verifies successfully and then fails at settlement, with an on-chain error that reads exactly like a spend control refusing the payment. Check this before you spend an afternoon debugging a policy that is not the problem.

```sh
PAYTO=G...
curl -s "https://horizon-testnet.stellar.org/accounts/$PAYTO" \
  | python3 -c 'import json,sys
for b in json.load(sys.stdin)["balances"]:
    print(b.get("asset_code", "native"), b["balance"])'
```

Your payment asset should appear in that list. The Circle testnet USDC issuer is `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`, and its Stellar Asset Contract id is `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`.

## 5. Set your public URL

The resource URL your route answers on is the URL that gets cataloged, and it is the URL the facilitator re-fetches later to decide `ownerVerified`. Deploy behind a public https hostname before you take your first real payment, because that first settlement is what writes the catalog entry.

> ⚠️ **A localhost URL produces a permanently unverifiable Bazaar entry that cannot be removed.** Ownership verification refuses http, loopback, private ranges, and cloud-metadata addresses before it opens a socket, and there is no self-service removal once an entry exists. Use a public https URL, or run your own facilitator for development and point `FACILITATOR_URL` at it.

## 6. Make the route discoverable

Declaring the **bazaar discovery extension** on the route makes it appear in the facilitator's catalog automatically after its **first settled payment**. There is no registration step and no form to submit: the settlement itself is the listing event.

```ts
import {
  declareDiscoveryExtension,
  bazaarResourceServerExtension,
} from "@x402/extensions/bazaar";

server.registerExtension(bazaarResourceServerExtension);

// route config:
//   extensions: declareDiscoveryExtension({
//     input: { topic: "perseverance" },
//     inputSchema: { properties: { topic: { type: "string" } } },
//     output: { example: { quote: "..." } },
//   })
```

> ⚠️ **Cataloging happens on settle, not on verify.** A verify-only call lists nothing, so a route you have only tested against `/verify` will never show up.

Ownership is trust-on-first-use: the first settled payment binds the resource URL to its `payTo`, and a different `payTo` settling the same URL is refused from the catalog (the payment still settles on-chain). See [Bazaar and discovery](../concepts/bazaar-and-discovery.md) for the full ownership and verification rules.

> **Note:** The catalog is ephemeral on the free tier. There is no persistent disk, so entries and URL ownership bindings vanish on every restart or idle sleep. A resource is re-cataloged after its next settled payment.

## 7. Verify your first payment

Take one real payment, then read the lowercase `extension-responses` header on the settle response. It is JSON keyed by extension name:

```json
{"bazaar":{"cataloged":true}}
{"bazaar":{"cataloged":false,"reason":"unbound_payto"}}
```

The header is returned on a successful `/settle` only. It is absent on 400s and on 402 challenges, so it is a settle-path signal and nothing else.

> **Note:** The most common reason value is `unbound_payto`, which means the URL has no settled payment yet. The other values are `no_discovery_extension`, `invalid_payto`, `ownership_tombstone_mismatch`, `schema_validation_failed`, `binding_refused`, `invalid_tool_name`, and `cataloging_error`.

Then read the catalog itself and print each item with its ownership verdict:

```bash
curl -s "https://vellar-facilitator.onrender.com/discovery/resources?network=stellar:testnet&limit=20" \
  | python3 -c '
import json, sys
data = json.load(sys.stdin)
for item in data["items"]:
    print(item.get("resource"), "ownerVerified=", item.get("trust", {}).get("ownerVerified"))
print("total:", data["pagination"]["total"])
'
```

## 8. Getting ownerVerified

`ownerVerified` is the signal agents read before paying you. The sibling fields `verification` and `acceptsVerification` are always `"unknown"` on every deployment, because they read from an external attestation service that is deployed nowhere, so `ownerVerified` is the only trust signal that actually works here.

Five things must be true about your resource URL, checked in order. Any one of them failing gives `unverifiable`:

1. **https and publicly resolvable.** http is rejected before a socket opens, and loopback, private ranges, and cloud-metadata addresses are refused.
2. **An unauthenticated `GET` returns 402.** A 200 or a 401 is unverifiable.
3. **The response carries a `PAYMENT-REQUIRED` header of 64 KiB or less.** The verdict comes entirely from the header; your body is never downloaded.
4. **The challenge's `accepts[].payTo` includes your address.** This is the actual ownership check.
5. **It answers within 3 seconds with no redirect.** A `301` from `/quote` to `/quote/` reads as unverifiable.

The two mistakes that catch people are advertising `localhost` instead of a public URL, and a trailing-slash mismatch: the canonical key strips the trailing slash, so a server answering only `/quote/` fails when it is checked at `/quote`.

`ownerVerified` self-heals. Once you have fixed the cause, it flips after your next settlement, subject to a 15-minute cooldown.

> **Note:** A parameterized route declared with `routeTemplate` (for example `"/inspect/{address}"`) stays in the catalog but is permanently `ownerVerified: false`, because a template is not a fetchable URL.

## 9. How agents find you

Once your endpoint is cataloged, agents search the Bazaar rather than being told your URL:

```ts
import { HTTPFacilitatorClient } from "@x402/core/http";
import { withBazaar } from "@x402/extensions/bazaar";

const bazaar = withBazaar(
  new HTTPFacilitatorClient({ url: "https://vellar-facilitator.onrender.com" }),
);

const { resources } = await bazaar.search({ query: "quote generator" });
```

Each result carries the URL, the price, the asset, the `payTo`, and the input schema, so the agent can construct and pay a call without knowing in advance that your endpoint exists. That is the whole point of declaring `inputSchema` in step 6: an agent that cannot tell what to send will not send anything.

> **Note:** Ranking is token-scored relevance, not semantic. A query that shares no tokens with your service name, description, or tags will not find you, however close it is in meaning. Write the listing metadata in the words a buyer would actually type. `serviceName` must be printable ASCII of at most 64 characters (a non-ASCII name is silently dropped, not transliterated), descriptions are clamped to 256 characters, and tags follow the same ASCII rule.

## 10. How payments reach you

```
agent discovers your endpoint in the Bazaar
  -> agent calls wallet.x402.fetch or the MCP x402_pay tool
  -> your server returns 402 with the payment terms
  -> agent signs the payment and retries the request
  -> facilitator verifies by re-simulating the signed payload
  -> facilitator settles on-chain, transferring from the agent to your payTo
     and sponsoring the network fee, so the agent needs no XLM
  -> your server receives the paid request and returns 200
  -> facilitator catalogs the resource
  -> agent reads your response
```

You receive the payment in your `payTo` account. You never touch Soroban, auth entries, or fee handling: the facilitator does all of that, and your route sees an ordinary paid HTTP request.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| The command is not in the command palette | The extension is not installed, or not activated in this window | Install `VellarWallet.vellar-x402` from the Marketplace, then reload the window |
| The injected code has type errors | The packages it imports are not installed | `npm install @x402/core @x402/stellar @x402/extensions` |
| `curl -I` returns 200, not 402 | `HEAD` carries no payment challenge, so it answers a plain 200 | Debug a paid route with `GET`, never `HEAD` |
| A Next.js Pages Router route is detected but nothing is injected | Injection is not supported for the Pages Router | Wire the gate by hand using the snippet in step 3 |
| The route works but never appears in the Bazaar | The discovery extension is not declared, or no payment has settled for it yet | Declare `declareDiscoveryExtension` on the route and make one real payment; verify-only traffic catalogs nothing |
| `extension-responses` says `cataloged: false` with `unbound_payto` | The URL has no settled payment yet, so nothing has bound it to your `payTo` | Take one real payment against the public URL, then re-read the header |
| `ownerVerified` stays `false` no matter what | You advertised a `localhost` or `http` URL, which can never pass verification | Redeploy behind a public https hostname; the entry self-heals after the next settlement, after a 15-minute cooldown |
| The payment settles but your `payTo` balance is unchanged | The `payTo` account has no trustline to the payment asset | Add the trustline, then re-run the Horizon check in step 4. The on-chain error reads exactly like a spend control refusing the payment, so check this first |
| The first request hangs for a minute or more | Free-tier facilitator cold start after 15 minutes idle | Warm it with `GET /health`, which is exempt from the rate limit, then retry with a generous timeout |

## Next steps

- [Charge for an endpoint](../sellers/charge-for-an-endpoint.md)
- [Get discovered](../sellers/get-discovered.md)
- [Bazaar and discovery](../concepts/bazaar-and-discovery.md)
- [Discover services](../buyers/discover-services.md)
