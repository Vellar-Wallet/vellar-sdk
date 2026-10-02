# VS Code Extension

> Add an x402 payment gate to any HTTP route in one command. The extension
> injects the boilerplate, the sidebar monitors your payments, and the first
> real settlement makes your endpoint discoverable by AI agents.

By the end of this page you will have installed the extension, added a payment
gate to an existing route, understood exactly what code gets injected and why,
activated your endpoint with a real test payment, and seen your endpoint appear
in the Bazaar catalog.

## The two surfaces

The extension has two separate surfaces that do different things.

| Surface | What it does | Added in |
| --- | --- | --- |
| Add payment command | Code generation: injects x402 boilerplate into your route file | v0.1.x |
| Sidebar | Monitors wallet balance, endpoints, settlements and earnings, and fires real test payments | v0.2.0 |

The command is code generation and nothing else: no test runner, no deployment,
no wallet management of its own. The sidebar is additive and independent of it.

## Prerequisites

- VS Code 1.80 or later
- An existing HTTP server in Express, Fastify, or Next.js App Router
- Node.js 18 or later
- A Stellar `G...` address to receive payments (your payTo address)
- A USDC trustline open on that address (see the next section)

## Before you start: open a USDC trustline

> ⚠️ **Your payTo address needs a USDC trustline before it can receive
> payments.** Without one, a payment verifies successfully and then fails at
> settlement with an on-chain error that reads exactly like a spend control
> refusing it. This is a one-time setup per address, done outside the
> extension.

Three ways to open one:

- **Freighter**: Settings, then Assets, then Add asset, then USDC
- **Stellar Laboratory**: `laboratory.stellar.org`
- Any Stellar wallet that supports custom assets

The sidebar's Wallet section shows an amber warning if your configured address
has no trustline or has not been funded yet.

## 1. Install the extension

Search "Vellar x402" in the VS Code Extensions panel, or install from the
command line:

```sh
code --install-extension VellarWallet.vellar-x402
```

[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=VellarWallet.vellar-x402)

On first activation an onboarding panel opens automatically, with three steps
tracked live: setting `payToAddress`, opening a route file, and running the
command. Completing all three opens the sidebar. You can reopen the panel at
any time:

```
Vellar: Reopen getting started
```

## 2. Set your payout address

In VS Code Settings, set:

```
vellar-x402.payToAddress = G...
```

This is the Stellar address where USDC lands on every payment, and it is the
only setting the command needs.

> ⚠️ **The address is inlined at generation time, not read at runtime.** The
> command reads `vellar-x402.payToAddress` once and writes it into the
> generated `PAYMENT_CONFIG.payToAddress` as a literal string. The generated
> code carries a comment claiming the value is read from the setting at
> runtime; that comment is inaccurate. If you change the setting after
> generating a gate, re-run the command on that route to update the inlined
> address.

A second setting, `vellar-x402.notifyOnEveryPayment` (boolean, default
`false`), turns on a notification for each individual payment.

## 3. Add a payment gate

Open a route file (`.js`, `.ts`, `.jsx` or `.tsx`) containing an Express,
Fastify, or Next.js App Router route, then run:

```
Vellar: Add x402 payment to this endpoint
```

The command:

1. Scans the open file and detects routes.
2. Shows a quick-pick to confirm the route, even when only one was found.
3. Refuses if a gate is already present, detected by its marker comment.
4. Prompts for a price in USDC (default 0.01, up to 7 decimal places, greater
   than zero).
5. Injects the boilerplate.
6. Moves your cursor to the first TODO in the discovery metadata block.
7. Offers to install the required packages using the package manager it detects
   from your nearest lockfile, which is monorepo-aware.

> **Note:** Next.js Pages Router routes are detected but never injected into.
> The command shows a guidance modal instead, because no x402 adapter for the
> Pages Router exists anywhere in the ecosystem. Two paths forward: migrate to
> the App Router, where `withX402` is fully supported, or wire the
> `x402ResourceServer` and `x402HTTPResourceServer` primitives by hand.

## What gets injected

The shape varies by framework. In every case your original handler body is
preserved untouched: the gate wraps around it rather than replacing it.

### Express

Two insertions. First, after your last import:

```ts
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import {
  bazaarResourceServerExtension,
  declareDiscoveryExtension,
} from "@x402/extensions/bazaar";
```

Then, immediately before your route:

```ts
// --- Vellar x402: payment gate for GET /weather ---
const PAYMENT_CONFIG = {
  payToAddress: "GA...", // your address, inlined at generation time
};
const x402FacilitatorClient = new HTTPFacilitatorClient({
  url: "https://vellar-facilitator.onrender.com",
});
const x402Server = new x402ResourceServer(x402FacilitatorClient)
  .register("stellar:testnet", new ExactStellarScheme())
  .registerExtension(bazaarResourceServerExtension);
const x402Routes = {
  "GET /weather": {
    accepts: {
      scheme: "exact" as const,
      price: "$0.05",
      network: "stellar:testnet" as const,
      payTo: PAYMENT_CONFIG.payToAddress,
    },
    description: "my-app, /weather ($0.05 USDC)", // TODO: add description
    serviceName: "my-app",
    tags: ["api", "x402"],
    extensions: declareDiscoveryExtension({
      input: {
        // TODO: example values for query or body parameters
      },
      inputSchema: {
        // TODO: JSON schema for those parameters
      },
      output: {
        example: {
          // TODO: add a real example response
        },
      },
    }),
  },
};
// --- end Vellar x402 setup ---
app.use(paymentMiddleware(x402Routes, x402Server));

// your original route handler follows, body untouched:
app.get("/weather", (req, res) => {
  res.json({ forecast: "sunny", tempF: 72 });
});
```

### Fastify

The same setup block. The gating call uses the variable name the detector
traced at your call site (`fastify`, `server` or `app`), never a hardcoded
`app`:

```ts
paymentMiddleware(fastify, x402Routes, x402Server);
```

### Next.js App Router

Your exported handler is renamed with an `_impl` suffix and its `export` is
dropped, with the body preserved verbatim. A new export wraps it:

```ts
// original renamed, export dropped:
async function GET_impl(req: Request) {
  // your handler body, untouched
}

// new export:
export const GET = withX402(GET_impl, x402RouteConfig, x402Server);
```

## Supported frameworks

| Framework | Support |
| --- | --- |
| Express | Full |
| Fastify | Full |
| Next.js App Router | Full |
| Next.js Pages Router | Detected, not injected |

## Fill in the discovery metadata

> ⚠️ **Fill in the discovery TODOs before your first real payment.** The
> `extensions` block is what makes a settled payment register your resource in
> the Bazaar catalog. The extension adds `declareDiscoveryExtension` for you,
> but the input and output examples are left as TODOs because they cannot be
> inferred from your source.

The cursor lands on the first TODO after injection. Replace them with real
values:

```ts
extensions: declareDiscoveryExtension({
  input: {
    topic: "perseverance",
  },
  inputSchema: {
    properties: {
      topic: {
        type: "string",
        description: "Topic to get a quote about",
      },
    },
  },
  output: {
    example: {
      quote: "Press on.",
    },
  },
}),
```

`serviceName` and `description` are pre-filled from the `name` field of your
nearest `package.json`. Edit them so they describe the endpoint accurately.

> **Note:** `serviceName` must be printable ASCII, at most 64 characters. A
> non-ASCII name is silently dropped at ingest rather than transliterated, and
> descriptions are clamped to 256 characters.

## 4. Install the packages

After injection the extension offers to install the dependencies. Click
"Install dependencies" to let it use your detected package manager, or install
them yourself:

| Framework | Install |
| --- | --- |
| Express | `npm install @x402/core @x402/stellar @x402/extensions @x402/express` |
| Fastify | `npm install @x402/core @x402/stellar @x402/extensions @x402/fastify` |
| Next.js App Router | `npm install @x402/core @x402/stellar @x402/extensions @x402/next` |

Next.js App Router additionally requires Next.js 16.2.6 or later, a peer
dependency of `@x402/next`.

## 5. Deploy to a public URL

Deploy your app however you normally would; this is outside the extension's
scope.

> ⚠️ **You need a public https URL.** The facilitator has to reach your
> endpoint to verify and settle payments, and `ownerVerified` requires https
> with no loopback or private range. A localhost URL produces a catalog entry
> that can never pass ownership verification and has no self-service removal.

## 6. Activate your endpoint

Open the Vellar sidebar from the activity bar. In My Endpoints, paste your live
deployed URL and click "Activate endpoint". The extension then fires a real
on-chain test payment, not a mock:

| Step | What happens |
| --- | --- |
| 1 | Generates a throwaway keypair, held in memory only and never persisted or logged |
| 2 | Checks that key is neither your payToAddress nor the endpoint's payTo |
| 3 | Funds the throwaway wallet through friendbot |
| 4 | Opens a USDC trustline on it |
| 5 | Buys testnet USDC on the DEX, targeting 5x the endpoint's real price |
| 6 | Requests your endpoint expecting a 402, signs the payment, submits, and settles |

On success a notification shows the settlement hash with a link to view it on
stellar.expert. On failure it points you at the Vellar x402 output channel.
Only one test payment runs at a time.

> **Note:** The price and payTo are read live from your endpoint's real 402
> challenge, never assumed. If your endpoint is not returning a valid
> challenge, the test payment fails at step 6.

## 7. Your endpoint is discoverable

Once that first payment settles, your endpoint appears in My Endpoints in the
sidebar, in `GET /discovery/resources` on the facilitator, and in Bazaar search
results. An agent can find and pay it without knowing the URL in advance. See
[Bazaar and discovery](../concepts/bazaar-and-discovery.md).

## The sidebar in detail

### Wallet

Your XLM and USDC balances for the configured `payToAddress`, polled every 30
seconds. It has four states:

| State | What you see |
| --- | --- |
| Not configured | "Not configured" with an Open Settings button |
| Invalid address | "Not a valid Stellar address" with an Open Settings button |
| Not funded | Amber: fund it with XLM first, then open a USDC trustline |
| Loaded, no trustline | Amber: payments to this address will fail on-chain |
| Loaded | USDC balance, XLM balance, and the truncated address with a Copy button |

Trustline detection looks for a balance entry matching the canonical testnet
USDC issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`, not for
a balance above zero, because a trustline can exist with a zero balance.

### My Endpoints

Catalog entries where your configured address is the `payTo`, read from
`/discovery/resources` and polled every 60 seconds. Each card carries the
resource URL, the price, an ownership badge (Verified, Proven unconfirmed,
Unverified, or Unknown), the settlement count and last settled time, and a Test
button. An "Activate endpoint" form sits below the cards.

> **Note:** An endpoint appears here only after its first payment settles.
> Generating the code alone does not register it anywhere.

### Recent Settlements

The last 10 on-chain settlements for your address, from the explorer API, with
the amount, a truncated payer address, a relative timestamp and a link to
stellar.expert. Paginated, and polled every 30 seconds.

This section cannot show which resource a given settlement paid for. On-chain
data records the transfer, not the resource it bought.

### Earnings Summary

Total, today and this-week USDC, plus a unique payer count, computed from the
Recent Settlements data alone. It is labelled "Based on your N most recent
settlements" because it is explicitly not a true all-time total.

## How payments reach you

```
Agent searches the Bazaar
       |
Agent calls x402_pay or wallet.x402.fetch()
       |
Your server returns 402 with the terms
       |
Agent signs a Soroban authorization entry
       |
Vellar facilitator verifies by re-simulation
       |
Facilitator settles on-chain
  - buyer to your payTo, in USDC
  - facilitator pays the network fee
       |
Your server returns 200 with the response
       |
Facilitator catalogs the resource
  - extension-responses: {"bazaar":{"cataloged":true}}
```

Your original handler runs unchanged, you collect USDC at your `payToAddress`,
and the facilitator handles every Stellar interaction.

## Known limitations

- Route detection is regex-based, so it misses multi-line route signatures and
  non-string paths.
- The Pages Router has no x402 adapter in the ecosystem, so the extension
  declines rather than inject code that would not work.
- Input and output schemas cannot be inferred from your source, which is why
  they are left as TODOs.
- Recent Settlements cannot attribute a settlement to a resource.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| The command is not in the palette | The extension has not activated | Open a `.js`, `.ts`, `.jsx` or `.tsx` file first, then reload the window |
| Your route is not detected | A multi-line signature or a non-string path, which regex detection misses | Add the gate by hand following [Charge for an endpoint](../sellers/charge-for-an-endpoint.md) |
| The command refuses to inject | A gate is already present, found by its marker comment | Remove the existing block first, or pick a different route |
| A Pages Router modal appears | No x402 adapter exists for the Pages Router | Migrate to the App Router, or wire the primitives by hand |
| "No USDC trustline" in the sidebar | The trustline is not open on your payTo | Open one in Freighter or Stellar Laboratory |
| A payTo change is not reflected | The address was inlined at generation time | Re-run the command on that route |
| Injected code has type errors | The packages are not installed | Install the framework's packages from the table above |
| `curl -I` returns 200, not 402 | HEAD carries no payment challenge | Debug with `GET`, never `HEAD` |
| The test payment fails at step 6 | The endpoint is not returning a valid 402 challenge | Confirm the server is running with the packages installed, then check the Vellar x402 output channel |
| The endpoint never appears in My Endpoints | No payment has settled for it yet | Run Activate endpoint, which fires a real payment |
| `ownerVerified` stays false | A localhost or http URL, which can never verify | Deploy behind a public https URL |
| A payment settles but the balance is unchanged | The payTo has no trustline to the asset | Open the trustline, then retry |

## Next steps

- [Charge for an endpoint](../sellers/charge-for-an-endpoint.md)
- [Get discovered](../sellers/get-discovered.md)
- [Bazaar and discovery](../concepts/bazaar-and-discovery.md)
- [Discover services](../buyers/discover-services.md)
