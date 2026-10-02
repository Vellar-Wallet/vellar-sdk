# Charge for an Endpoint

> Add an x402 payment gate to any HTTP route in three steps: point your resource server at the Vellar facilitator, declare the payment requirements, and collect on every request that settles.

By the end of this page you will have a working paid HTTP endpoint that accepts
testnet USDC, catalogs itself in the Bazaar automatically after its first
settled payment, and passes the `ownerVerified` check so agents have a reason to
trust it.

## Prerequisites

- Node.js 18 or later
- An existing HTTP server (Express, Hono, Fastify or similar). This page adds a
  gate to a route you already have; it does not ask you to restructure anything
- A funded testnet account with a trustline to your payment asset. That account
  is your `payTo`
- Your payment asset's SEP-41 contract id

> **Note:** If you have none of those yet, the facilitator repo provisions all of
> them in one command:
>
> ```sh
> git clone https://github.com/Vellar-Wallet/vellar-facilitator
> cd vellar-facilitator/examples && npm install
> node provision-testnet.mjs
> ```
>
> It creates an issuer, a Stellar Asset Contract, a merchant trustlined to it,
> and a funded payer, in roughly 40 seconds to 3 minutes, and prints a
> paste-ready env block. Pass `AGENT_PUBLIC` to also provision a Vellar
> smart-account wallet for the buyer side. If you would rather use an asset that
> already exists, Circle's official testnet USDC issuer is
> `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` and its SAC contract
> id is `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`.

## 1. Install the packages

```sh
npm install @x402/core @x402/stellar @x402/extensions
```

`@x402/core` carries the resource server and the HTTP facilitator client,
`@x402/stellar` the `exact` scheme for Stellar, and `@x402/extensions` the
bazaar discovery extension that gets your route listed.

## 2. Wire the facilitator client

Exactly one thing changes on your server: you point an `x402ResourceServer` at
the Vellar facilitator. Your routes, your auth, and your business logic stay
where they are.

```ts
import { HTTPFacilitatorClient } from "@x402/core/http";
import { x402ResourceServer } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";

const server = new x402ResourceServer(
  new HTTPFacilitatorClient({
    url: "https://vellar-facilitator.onrender.com",
  }),
)
  .register("stellar:testnet", new ExactStellarScheme())
  .registerExtension(bazaarResourceServerExtension);
```

The facilitator verifies and settles every payment. Your server never touches
Soroban, never builds or inspects an auth entry, and never handles fees: the
facilitator re-simulates the signed payment to verify it, submits it on-chain,
and sponsors the network fee from
`GBUCR6H22CZC5OYHBJIEUS2JFZBOB63AHEGTCV6UEPMD2TMLKG2ZMIW4`.

> **Note:** The hosted facilitator is `stellar:testnet` only and runs on a free
> tier. It sleeps after 15 minutes idle, so the first request after a quiet spell
> takes roughly 45 seconds (measured). Send a warming
> `GET /health` before a request you care about.

## 3. Declare the payment requirements

Amounts are atomic units. SEP-41 assets and Stellar Asset Contracts use 7
decimals, so `1000000` is 0.1 units and `10000000` is 1.0. Treat amounts as
bigints in base units and never as floating point.

```ts
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

const routeConfig = {
  accepts: [
    {
      scheme: "exact",
      network: "stellar:testnet",
      payTo: process.env.PAYTO!,
      price: {
        asset: process.env.ASSET!,
        amount: "1000000", // 0.1 USDC (7 decimals)
      },
      maxTimeoutSeconds: 120,
    },
  ],
  description: "One quote, priced per call",
  mimeType: "application/json",
  extensions: declareDiscoveryExtension({
    input: { topic: "perseverance" },
    inputSchema: { properties: { topic: { type: "string" } } },
    output: { example: { quote: "..." } },
  }),
};
```

The `extensions` block is what makes the route discoverable. Cataloging happens
on settle, not on verify, so the entry appears after the first real payment, not
when you deploy.

> ⚠️ **Your `payTo` needs a trustline to the payment asset.** Without one, a
> payment verifies successfully and then fails at settlement with an on-chain
> error that reads exactly like a spend control refusing it, which sends people
> debugging policies for an hour. Check the trustline before you debug anything
> else. The `seller.mjs` example checks it at boot for this reason.

## 4. Check your trustline at boot

The example seller in the facilitator repo fails fast with a clear error if the
`payTo` account has no trustline to `ASSET`:

```sh
PAYTO=G... ASSET=C... PRICE_ATOMIC=1000000 node seller.mjs
```

It also reads `SELLER_PORT` and `FACILITATOR_URL`. To check the same thing
yourself against Horizon:

```sh
curl -s "https://horizon-testnet.stellar.org/accounts/$PAYTO" \
  | python3 -c 'import json,sys
for b in json.load(sys.stdin)["balances"]:
    print(b.get("asset_code", "native"), b["balance"])'
```

Your payment asset should appear in that list. If it does not, add the trustline
before taking a single payment.

## 5. Use a public URL

The resource URL you advertise is the URL that gets cataloged, and it is the URL
the facilitator re-fetches to decide `ownerVerified`. A `localhost` URL can never
pass that check: verification refuses http, loopback, private ranges, and
cloud-metadata addresses before it opens a socket.

```sh
PAYTO=G... \
ASSET=C... \
PRICE_ATOMIC=1000000 \
SELLER_PORT=4031 \
FACILITATOR_URL=https://vellar-facilitator.onrender.com \
node seller.mjs
```

`ownerVerified: true` needs five things to be true about that URL, checked in
order, with any one failure giving `unverifiable`:

1. https and publicly resolvable
2. An unauthenticated `GET` returns 402 (a 200 or a 401 is unverifiable)
3. It carries a `PAYMENT-REQUIRED` header of 64 KiB or less (the verdict comes
   entirely from the header, your body is never downloaded)
4. The challenge's `accepts[].payTo` includes your address (this is the actual
   check)
5. It answers within 3 seconds with no redirect (a `301` from `/quote` to
   `/quote/` reads as unverifiable)

> ⚠️ **Your first settlement against the hosted facilitator writes a public
> catalog entry.** A `localhost` URL produces an entry that can never pass
> ownership verification, and there is no self-service removal, so every agent
> reading the catalog pays the cost of it until the next restart or idle sleep
> clears the catalog. For local development, run your own facilitator and set
> `FACILITATOR_URL`. With a localhost URL and the shared facilitator, `seller.mjs`
> refuses to start; `ALLOW_UNVERIFIABLE_ON_SHARED=1` bypasses that, and you
> should use it only if you understand what it leaves behind.

## 6. Verify your first payment

Take one real payment, then read the catalog:

```sh
curl -s "https://vellar-facilitator.onrender.com/discovery/resources?network=stellar:testnet&payTo=$PAYTO" \
  | python3 -m json.tool
```

The response is `{ "x402Version": ..., "items": [...], "pagination": { "limit":
20, "offset": 0, "total": ... } }`. If you would rather not wait for a poll, the
settle response tells you directly. On a successful `/settle` the facilitator
returns a lowercase `extension-responses` header, JSON keyed by extension name:

```json
{"bazaar":{"cataloged":true}}
{"bazaar":{"cataloged":false,"reason":"unbound_payto"}}
```

The header is absent on 400s and on 402 challenges, so it is a settle-path
signal only. If `cataloged` is `false`, read the `reason` field:
`no_discovery_extension`, `invalid_payto`, `ownership_tombstone_mismatch`,
`unbound_payto`, `schema_validation_failed`, `binding_refused`,
`invalid_tool_name`, or `cataloging_error`. Each one is explained in
[Bazaar and discovery](../concepts/bazaar-and-discovery.md).

> **Note:** The hosted catalog is ephemeral. The free tier has no persistent
> disk, so catalog entries and URL ownership bindings vanish on every restart or
> idle sleep. Your resource is re-cataloged after its next settled payment, and
> `ownerVerified` self-heals after the next settlement, subject to a 15-minute
> cooldown.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| Payment verifies, then fails at settlement with an error that looks like a spend control refusal | Your `payTo` has no trustline to the payment asset | Add the trustline, then check it with the Horizon command in step 4. `seller.mjs` catches this at boot |
| `ownerVerified` is `false` and never becomes `true` | The advertised URL is http, `localhost`, a private range, or a cloud-metadata address | Advertise a public https URL. Verification refuses these before opening a socket, so no amount of retrying helps |
| `cataloged: false` with `reason: "unbound_payto"` | The resource URL is already bound to a different `payTo` (ownership is trust-on-first-use, bound by the first settled payment) | Settle from the bound `payTo`, or use a URL you own. On the hosted instance the first-settler race reopens after each restart |
| `cataloged: false` with `reason: "binding_refused"` | The facilitator refused to bind this URL to this `payTo` | The payment still settled on-chain; nothing was lost. Confirm the URL and `payTo` you advertise are the pair you intend, then settle again |
| `curl -I` returns `200` instead of `402` | `HEAD` carries no payment challenge, so a correctly wired route looks unwired | Debug paid routes with `GET`, never `HEAD` |
| The route works in a browser but `ownerVerified` stays `unverifiable` | Trailing-slash mismatch: the canonical key strips the trailing slash, so a server answering only `/quote/` fails when checked at `/quote` | Serve the route without the trailing slash. A `301` redirect does not help, because redirects are not followed |

## Next steps

- [Get discovered](./get-discovered.md)
- [`upto` metered payments](./upto-metered-payments.md)
- [Bazaar and discovery](../concepts/bazaar-and-discovery.md)
- [VS Code extension](../agent-tooling/vscode.md)
