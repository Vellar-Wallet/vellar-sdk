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

## Bring your own payment asset

Read this before trying anything else on this page — it's the step most
likely to stop you.

The facilitator settles in whatever SEP-41 asset a resource names. There is
**no canonical asset, no built-in test token, and no faucet.** To try any
flow below you need your own: an issuer, a Stellar Asset Contract, a
merchant trustlined to it, and a funded payer. (This is `stellar:testnet`
only — testnet assets are not money, so there's nothing to keep safe here.)

```sh
git clone https://github.com/Vellar-Wallet/vellar-facilitator
cd vellar-facilitator/examples && npm install
node provision-testnet.mjs
```

Creates all four in roughly 40 seconds to 3 minutes and prints a
paste-ready env block. Pass it an `AGENT_PUBLIC` to also provision a Vellar
smart-account wallet for the buyer side — see [Agent keys](./agent-keys.md)
for generating that keypair without the secret ever touching a command line
or a file.

**One old Bazaar entry, `X402TST` (`CDYCX4PE…`), cannot be acquired by
anyone.** Its issuer keypair was generated in-process by a throwaway script,
and the secret no longer exists — nobody can mint more of it, including us.
If you find that contract id in `/discovery/resources`, don't spend time
trying to get a balance of it. This warning is about **that entry only** —
the deployed demo seller itself now charges real testnet USDC and is payable
by anyone; see the next section.

## Paying the deployed demo seller

Want to test against a live seller without running your own?
`https://vellar-seller-demo.onrender.com/quote` charges **0.1 real testnet
USDC** (`USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`,
Circle's official testnet issuer) with sponsored fees. Testnet USDC is
freely obtainable with no faucet form: Friendbot an account, then buy USDC
on the testnet DEX with the Friendbot XLM — the same two steps the
[playground](https://playground.vellar.xyz) performs when it funds a
session wallet:

```ts
import {
  Asset,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");

const payer = Keypair.random();
await fetch(`https://friendbot.stellar.org?addr=${payer.publicKey()}`);

const account = await horizon.loadAccount(payer.publicKey());
const tx = new TransactionBuilder(account, { fee: "1000", networkPassphrase: Networks.TESTNET })
  .addOperation(Operation.changeTrust({ asset: USDC }))
  .addOperation(
    Operation.pathPaymentStrictReceive({
      sendAsset: Asset.native(),
      sendMax: "1000", // XLM you are willing to spend
      destination: payer.publicKey(),
      destAsset: USDC,
      destAmount: "0.5", // USDC you receive
    }),
  )
  .setTimeout(60)
  .build();
tx.sign(payer);
await horizon.submitTransaction(tx);
console.log("payer:", payer.publicKey(), "secret:", payer.secret());
```

Then pay the seller with that keypair (classic flow, from `examples/`):

```sh
RESOURCE_URL="https://vellar-seller-demo.onrender.com/quote?topic=perseverance" \
PAYER_SECRET=S...   # the secret the script printed
node buyer-classic.mjs
```

Both steps are verified working end to end. Note the demo seller is a free
Render instance — from deep sleep the first request can take a minute or
more to answer. For the **smart-account/agent** flow you still provision
your own seller (below): a fresh smart account holds no USDC, and the
budget-policy story needs an asset your policies are scoped to.

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

`/verify` and `/settle` accept two schemes: `exact` (price known and signed
upfront — what everything on this page assumes) and the experimental
`upto` (buyer signs a ceiling, facilitator settles the metered actual,
enforced on-ledger) — see [`upto` — Metered Payments](./upto.md).

Want to see real settlements instead of trusting this page? [explorer.vellar.xyz](https://explorer.vellar.xyz)
is a public transaction explorer for this facilitator.

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

Your `payTo` account needs a **trustline to the payment asset** you declare,
or a payment verifies successfully and then fails at settlement with an
on-chain error that reads exactly like a spend control refusing it — worth
checking before debugging anything else.

Cataloging happens on **settle**, not on verify: a resource shows up in
discovery only after a real payment for it succeeds. Verify-only traffic
(a client checking a payload without submitting) catalogs nothing.

## For buyers and agents

`vellar-sdk`'s [`wallet.x402.fetch()`](./x402.md) works against any compliant
facilitator the seller chose — nothing to configure on the buyer side. The
difference this facilitator makes: if the paying account carries a
spending-limit policy, the payment **settles** here where other facilitators
reject it on the fee ceiling.

Building your own buyer instead of using the SDK? **Echo `required.extensions`
into your payment payload** — that echo is what tells the facilitator to
catalog the resource. Skip it and the payment settles fine, but nothing gets
listed, with no error on either side.

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

## Running the full loop

Getting from "I have a wallet" to "I paid for a resource and it's
discoverable," using this page alone:

```sh
# 0. From "Bring your own payment asset" above — you already have this repo
#    cloned and examples/ installed.

# 1. Provision an asset + funded accounts (~40s–3min)
node provision-testnet.mjs

# 2. Start a seller advertising it, with the PAYTO/ASSET it just printed.
#    Heads up: with a localhost URL and the SHARED facilitator, seller.mjs
#    REFUSES to start (a localhost resource would enter the public Bazaar
#    permanently, unverifiable). For local testing add
#    ALLOW_UNVERIFIABLE_ON_SHARED=1, or run your own facilitator and set
#    FACILITATOR_URL — the refusal message walks through both.
PAYTO=G... ASSET=C... PRICE_ATOMIC=1000000 node seller.mjs

# 3. Pay it — classic keypair, no extra dependencies. No second funded
#    account needed: the official client simulates from the SDK's own null
#    account, so the payer is never the transaction source.
RESOURCE_URL=http://127.0.0.1:4031/quote \
PAYER_SECRET=S... \
node buyer-classic.mjs

# (or buyer.mjs, for a Vellar smart-account payer with an on-chain budget —
# see Agent keys for generating its session key)
```

That settles a real payment and catalogs the resource — check
`GET /discovery/resources` afterward and it's there. Expect to retry step 3
sometimes (see [Limits](#limits-and-operational-caveats) below); nothing is
spent on a failed attempt.

**This writes to the hosted instance's shared catalog, permanently — read
this before you run step 3.** A `localhost` seller URL can never pass
ownership verification, and there's no self-service (or supported operator)
removal, so it stays listed as an unreachable entry for every other agent
reading the catalog. Nothing breaks and your payment is unaffected — the
cost is borne by everyone else. To avoid leaving one, run your own
facilitator instead (one command and a local database — see `guide.md`
below) and only point at the hosted instance once your seller has a public
URL.

For the complete merchant/buyer split — ownership verification in full,
every rough edge on the hosted instance — read
[`docs/using-it.md`](https://github.com/Vellar-Wallet/vellar-facilitator/blob/main/docs/using-it.md)
(pointing at a running facilitator) and
[`docs/guide.md`](https://github.com/Vellar-Wallet/vellar-facilitator/blob/main/docs/guide.md)
(running your own). This page summarizes; those are the full reference.

## Trust signals

Each catalog entry's payment options carry a trust block so agents can weigh
a resource before paying:

- `settlements` — count of observed on-chain settlements for this resource.
- `uniquePayers` — how many distinct accounts have paid it.
- `observedSettlements` / `statsSource` — provenance: whether the stats were
  observed live by this process or restored from persistence.
- `verification` / `acceptsVerification` — **always `"unknown"`, on every
  deployment.** These read from an external attestation service that is
  deployed nowhere — that's architectural, not an outage, and it will not
  change on its own. **Don't filter on `?verified_only=true`** — it filters
  on this field, and since the field can never be anything but `"unknown"`
  here, the facilitator refuses the filter outright rather than silently
  hand back an empty list: `400 { "error": "verified_only_unavailable",
  "reason": "no_verdict_source_configured" }`, with `ownerVerified` named in
  the response as the signal that does work.
- `ownerVerified` — a **different, working** field, computed by the
  facilitator itself with no external dependency. `true` only when the
  facilitator fetched your resource's own URL and found your `payTo` in its
  402 challenge — the signal that a listing isn't a squat. On the hosted
  free-tier instance it's lost on every restart (no persistent disk — see
  [Limits](#limits-and-operational-caveats)), but it self-heals: your next
  settlement re-runs the check after a 15-minute cooldown, with no operator
  involved.

Getting `ownerVerified: true` needs five things to be true about your
resource URL, checked in this order — any one failing gives `unverifiable`:

| # | Requirement | Why |
| --- | --- | --- |
| 1 | **https** and publicly resolvable | http is rejected before a socket opens; so are loopback, private ranges, and cloud-metadata addresses |
| 2 | An **unauthenticated `GET` returns 402** | The verifier sends no payment — a 200, a 401, or anything else is unverifiable |
| 3 | Carries a `PAYMENT-REQUIRED` header **≤ 64 KiB** | The verdict comes entirely from the header; your body is never downloaded |
| 4 | The challenge's `accepts[].payTo` **includes your address** | This is the actual check |
| 5 | Answers within **3 seconds**, with **no redirect** | Redirects aren't followed — `301 /quote → /quote/` reads as unverifiable |

Two things that catch people: advertise your **public** URL, not
`localhost` — a loopback address can never verify — and the canonical key
strips a trailing slash, so a server that only answers `…/quote/` and 404s
on `…/quote` fails verification against the URL it's actually checked at.

## Limits and operational caveats

Things a developer building against the hosted instance should know up front:

- **Settlement can still fail on testnet — retry, don't debug.** `/settle`
  occasionally returns an empty `transaction` field with one of two reason
  codes: `settle_exact_stellar_transaction_submission_failed` or
  `settle_exact_stellar_transaction_failed`. Both mean the same thing — the
  transaction was **never submitted**, so nothing was spent and a retry
  cannot double-pay. Sign a fresh payload and retry (signatures expire in
  ledgers, not wall-clock, so a cached one won't work anyway). Root cause:
  the underlying Soroban RPC occasionally answers `TRY_AGAIN_LATER` to a
  perfectly valid transaction, for reasons it doesn't state (not sponsor
  contention, not sequence numbers — see
  [`diagnosis-settle-failures.md`](https://github.com/Vellar-Wallet/vellar-facilitator/blob/main/docs/diagnosis-settle-failures.md)
  in the repo for the ruled-out list). **Since 2026-08-15 the facilitator
  retries this itself** before giving up (two attempts, 6s apart, plus a
  separate one-retry guard for a related ledger-skew failure on `/verify`
  and `/settle`) — so you should see this less often than earlier sessions
  did, though not never: an automated probe that ships with the retry,
  running a controlled comparison (identical conditions, with and without
  the retry) every few hours, has recorded **zero settlement failures in
  either arm across its full run history so far** — meaning the RPC hasn't
  been misbehaving during that window in a way this measurement caught, not
  that the underlying issue is confirmed gone. Earlier, pre-retry sessions
  saw failure rates as high as 1-in-3. Keep "sign fresh, retry once" as the
  correct client-side handling regardless — it costs nothing when nothing
  fails.
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
  bodies are capped at 32 KiB; `/health` is exempt from the rate limit.
- **Settlement can be refused.** `/settle` returns
  `503 { error: "settlement_refused", reason }`. `sponsor_balance_low`
  (sponsor under its hard balance floor) refuses on every network. Four
  spend-policy reasons — `rate_limited_payto`, `rate_limited_url`,
  `spend_ceiling`, `unbound_pool_exhausted` — refuse on pubnet; on testnet
  they are logged as would-reject and the settlement proceeds, so you
  cannot test your handling of a real one there.
- **Debug a "not working" paid route with `GET`, not `HEAD`.** `curl -I`
  returns a plain `200` on a paid route — HEAD doesn't carry the payment
  challenge, so a correctly wired route looks broken. Use `GET`.
- **`/health`'s `unverifiableEntries` is absent when zero, not `0`.** A
  healthy catalog doesn't carry the key at all — check for its presence,
  not its value, or "no such field" reads as "the endpoint doesn't report
  this" when it actually means everything is fine.
- **`/health` also reports `reverifyPending`** — the count of ownership
  re-verification checks still in flight after a restart (see
  `ownerVerified` above: it's rebuilt on the next settlement after any
  restart, not stored). `0` means the catalog's trust state is settled;
  anything higher means check back shortly rather than treat what you just
  read as final.
- **No guaranteed warm window, but the odds are better on weekdays.** A
  best-effort keep-warm job pings the facilitator and demo seller every 10
  minutes, **07:00–21:00 UTC on weekdays** — that narrows how often you'll
  hit a cold instance during that window, but GitHub Actions scheduling is
  best-effort and can slip past the 15-minute idle timeout, so it is not a
  promise. Outside that window, or if a ping slips, assume cold. Send a
  warming `GET /health` (rate-limit-exempt) with a ~120s timeout ahead of a
  real request rather than let a user's first call eat the cold start. It
  then stays warm for 15 minutes past your last call.

## Proven end to end

The full loop is live-verified on testnet with on-chain settlement hashes: a
policy-governed Vellar smart account paid a Bazaar-declared resource through
the hosted facilitator, fees were sponsored by the facilitator's own
account, and the resource became searchable automatically. Details, hashes,
and runnable seller/buyer examples:
[`docs/decisions.md`](https://github.com/Vellar-Wallet/vellar-facilitator/blob/main/docs/decisions.md)
and
[`examples/`](https://github.com/Vellar-Wallet/vellar-facilitator/tree/main/examples)
in the repo — or skip the hashes and browse real settlements yourself at
[explorer.vellar.xyz](https://explorer.vellar.xyz), including `upto` ones.
