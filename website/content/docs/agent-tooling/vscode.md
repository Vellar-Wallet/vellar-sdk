# VS Code Extension

> Add an x402 payment gate to an HTTP route in one command, without leaving your editor.

By the end of this page you will have the **Vellar x402** extension installed, a payment gate added to a route in your own server, and a clear picture of what the extension injects, which frameworks it can inject into, and how to make the gated route discoverable in the Bazaar.

## Prerequisites

- **VS Code** with the Extensions panel available.
- **An existing HTTP server** written in Express, Fastify, or the Next.js App Router. The extension gates a route you already have; it does not scaffold a server for you.
- **Node 18 or later.**

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

## 4. Make the route discoverable

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

> ⚠️ **Cataloging happens on settle, not on verify.** A verify-only call lists nothing, so a route you have only tested against `/verify` will never show up. And the first settlement writes to a **shared** catalog permanently: never point a `localhost` route at the hosted facilitator, because a loopback URL can never pass ownership verification and there is no self-service removal once the entry exists.

Ownership is trust-on-first-use: the first settled payment binds the resource URL to its `payTo`, and a different `payTo` settling the same URL is refused from the catalog. See [Bazaar and discovery](../concepts/bazaar-and-discovery.md) for the full ownership and verification rules.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| The command is not in the command palette | The extension is not installed, or not activated in this window | Install `VellarWallet.vellar-x402` from the Marketplace, then reload the window |
| The injected code has type errors | The packages it imports are not installed | `npm install @x402/core @x402/stellar @x402/extensions` |
| The route returns 200 to `curl -I` | `HEAD` carries no payment challenge, so it answers a plain 200 | Debug a paid route with `GET`, not `HEAD` |
| A Next.js Pages Router route is detected but nothing is injected | Injection is not supported for the Pages Router | Wire the gate by hand using the snippet in step 3 |
| The route works but never appears in the Bazaar | The discovery extension is not declared, or no payment has settled for it yet | Declare `declareDiscoveryExtension` on the route and make one real payment; verify-only traffic catalogs nothing |
| Payments fail at settlement although verify passed | The `payTo` account has no trustline to the payment asset | Add a trustline for the asset you declare. The on-chain error reads exactly like a spend control refusing the payment, so check this first |

## Next steps

- [Bazaar and discovery](../concepts/bazaar-and-discovery.md)
- [x402 Facilitator](../facilitator.md)
- [Pay for a resource](../buyers/pay-for-a-resource.md)
- [The payment loop](../concepts/payment-loop.md)
