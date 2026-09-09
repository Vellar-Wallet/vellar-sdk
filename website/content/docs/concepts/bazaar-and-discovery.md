# Bazaar and Discovery

> The Bazaar is a catalog of paid resources on Stellar. A resource enters it automatically when a payment for it settles. No registration, no API key, no manual listing.

By the end of this page you will understand how a resource enters the catalog,
what `ownerVerified` means and the five requirements to get it, which trust
signals actually tell you something before you pay, and why the catalog rejects
all `localhost` URLs permanently.

## Prerequisites

- Familiarity with the x402 challenge and settle flow (see
  [The payment loop](./payment-loop.md))
- Access to a facilitator. The hosted instance is
  `https://vellar-facilitator.onrender.com` (`stellar:testnet` only, free tier,
  sleeps after 15 minutes idle, so the first call can take 30-90s and
  occasionally up to 2 minutes)
- `curl` and `python3` for the inspection commands near the end

## How a resource enters the catalog

Cataloging is settlement-gated and automatic. There is no registration
endpoint, no key to request, and no form. Two things must be true:

1. The seller's 402 response carries the bazaar discovery extension, declared
   with `declareDiscoveryExtension` on the route.
2. A real payment for that resource settles.

When both are true, the facilitator's settle hook extracts the metadata from
the payment payload and writes a catalog entry. A verify-only call catalogs
nothing: a client that checks a payload without submitting it leaves no trace
in the Bazaar.

Buyers building their own client have one obligation here: echo
`required.extensions` into the payment payload. That echo is what tells the
facilitator to catalog the resource. Skip it and the payment settles fine, but
nothing gets listed, with no error on either side.

> ⚠️ **Your first settlement writes to the shared catalog permanently.** A
> `localhost` URL can never pass ownership verification (https only, no
> loopback), there is no self-service removal, and the entry stays listed as an
> unreachable resource for every agent reading the catalog. Run a local
> facilitator for development and only point at the hosted instance once your
> seller has a public https URL.

## Ownership binding

URL ownership is trust-on-first-use. The first settled payment for a resource
URL binds that URL to its `payTo`.

A different `payTo` settling the same URL afterwards is refused from the
catalog. The payment itself goes through (the money moves on-chain, exactly as
signed), but the catalog entry is not updated. Two consequences follow:

- Squatting a listing costs a real, on-chain payment, and still does not get
  you the entry once the URL is bound.
- The legitimate owner reclaims a listing by settling once more.

This was validated with a controlled A/B test. Pre-fix, transaction
`d56dc927a7c7c019...` shows a second settlement for the same URL from a
different `payTo` overwriting the catalog entry and inheriting the legitimate
seller's trust stats. Post-fix, transaction `a909e4748c83f559...` shows the
identical attack refused by the ownership binding: the catalog entry was
unchanged. Both payments succeeded on-chain. "Blocked" here means the catalog
protected the legitimate seller, not that the payment failed.

> **Note:** On the hosted free-tier instance the first-settler race reopens
> after each restart, because the ownership bindings are not persisted. See
> the note under `ownerVerified` below.

## ownerVerified

`ownerVerified: true` means the facilitator fetched your resource URL itself
and found your `payTo` inside your own 402 challenge. It is computed by the
facilitator with no external dependency, and it is the signal that a listing is
not a squat.

Five things must be true about your resource URL, checked in this order. Any
one failing gives `unverifiable`.

| # | Requirement | Why |
| --- | --- | --- |
| 1 | **https** and publicly resolvable | http is rejected before a socket opens; loopback, private ranges and cloud-metadata addresses are refused |
| 2 | An **unauthenticated `GET` returns 402** | The verifier sends no payment, so a 200 or a 401 is unverifiable |
| 3 | Carries a `PAYMENT-REQUIRED` header of **64 KiB or less** | The verdict comes entirely from the header; the body is never downloaded |
| 4 | The challenge's `accepts[].payTo` **includes your address** | This is the actual check |
| 5 | Answers within **3 seconds** with **no redirect** | Redirects are not followed, so `301 /quote` to `/quote/` reads as unverifiable |

Two mistakes catch most people:

- **Advertising `localhost` instead of a public URL.** A loopback address can
  never verify, and the entry it creates is permanent.
- **A trailing-slash mismatch.** The canonical key strips the trailing slash,
  so a server that only answers `/quote/` fails when it is checked at `/quote`.

> **Note:** On the free-tier hosted instance `ownerVerified` is lost on every
> restart, because there is no persistent disk. It self-heals: the next settled
> payment re-runs the check, subject to a 15-minute cooldown. A `false` value
> there is usually a restart signal, not a squat signal.

## Trust signals in catalog results

Each catalog entry's payment options carry a trust block so an agent can weigh
a resource before paying.

| Field | What it tells you | Works? |
| --- | --- | --- |
| `settlements` | Count of observed on-chain settlements for this resource | Yes |
| `uniquePayers` | How many distinct accounts have paid it | Yes |
| `ownerVerified` | The facilitator confirmed ownership by fetching the URL | Yes, use this |
| `verification` | Always `"unknown"` | No, do not use |

`verification` and `acceptsVerification` are always `"unknown"` on every
deployment. They read from an external attestation service that is deployed
nowhere. That is architectural, not an outage, and it will not change on its
own.

> ⚠️ **Do not filter on `verified_only=true`.** It filters on `verification`,
> which can never be anything but `"unknown"` here, so rather than silently
> returning an empty list the facilitator refuses the filter outright with
> `400 {"error":"verified_only_unavailable","reason":"no_verdict_source_configured"}`.
> The refusal names `ownerVerified` as the signal that does work.

## Why metadata is untrusted

Clients echo the resource block into the payment payload. That means every
field in a listing arrives at the facilitator by way of a client, and the
facilitator treats all of it as attacker-influenceable. Nothing in the
metadata is a claim the facilitator vouches for; only `ownerVerified`,
`settlements` and `uniquePayers` are things it observed for itself.

So metadata is sanitized at ingest:

- `serviceName` must be printable ASCII, maximum 64 characters. A non-ASCII
  name (non-Latin characters, emoji) is **silently dropped**, not
  transliterated.
- Descriptions are clamped to 256 characters.
- Tags follow the same printable-ASCII rule.

If your service name disappears from a listing, this is why. Rename it in
ASCII and settle once more.

## The extension-responses header

On a successful `/settle`, the facilitator returns a lowercase
`extension-responses` header. Its value is a JSON object keyed by extension
name. The header is absent on non-settle paths: 400s and 402 challenges do not
carry it.

```json
{"bazaar":{"cataloged":true}}
```

```json
{"bazaar":{"cataloged":false,"reason":"unbound_payto"}}
```

`bazaar.reason` is omitted when `cataloged` is `true`. The eight values it can
take:

| Reason | Meaning |
| --- | --- |
| `no_discovery_extension` | The 402 response did not declare the bazaar discovery extension, or the client did not echo it |
| `invalid_payto` | The `payTo` in the payload is not a usable Stellar address |
| `ownership_tombstone_mismatch` | The URL carries an ownership record that this `payTo` does not match |
| `unbound_payto` | The `payTo` is not bound to this resource URL |
| `schema_validation_failed` | The listing metadata or route template failed validation and was dropped |
| `binding_refused` | The URL is already bound to a different `payTo` (trust-on-first-use) |
| `invalid_tool_name` | The declared MCP tool name was not acceptable |
| `cataloging_error` | Cataloging failed internally; the payment is unaffected |

A payment can succeed while cataloging fails. Cataloging never affects
settlement, so the money moving is not evidence that the resource was listed.
Read this header to confirm.

## Check your own listing

List cataloged resources and print each one with its `ownerVerified` value:

```bash
curl -s "https://vellar-facilitator.onrender.com/discovery/resources?limit=20" \
  | python3 -c '
import json, sys
data = json.load(sys.stdin)
for item in data["items"]:
    print(item.get("resource"), "ownerVerified=", item.get("ownerVerified"))
print("total:", data["pagination"]["total"])
'
```

Then check the catalog's own health:

```bash
# unverifiableEntries is ABSENT when zero, not 0, so absence means healthy.
# reverifyPending > 0 means ownership checks are still in flight after a
# restart, so check back shortly rather than treating what you read as final.
curl -s "https://vellar-facilitator.onrender.com/health" | python3 -m json.tool
```

`/health` also reports `catalogFrozen`, which tells you whether the catalog has
stopped accepting writes. `/health` is exempt from the 60 requests/min per IP
rate limit, so it is also the right endpoint to warm a sleeping instance with
before a real request.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `ownerVerified` never becomes `true`, entry stays listed | The advertised URL is `localhost` or another loopback or private address; requirement 1 rejects it before a socket opens | Advertise a public https URL. The bad entry cannot be removed, so develop against a local facilitator and only point at the hosted instance once the URL is public |
| `ownerVerified: false` on a working public seller | Trailing-slash mismatch: the canonical key strips the trailing slash, so a server answering only `/quote/` is checked at `/quote`. A `301` is not followed | Serve the challenge at the exact canonical URL with no redirect |
| `cataloged: false` with `binding_refused` | The resource URL is already bound to a different `payTo` under trust-on-first-use | If you are the legitimate owner, settle once from the bound `payTo`, or settle again after a restart cleared the binding on the hosted instance |
| `cataloged: false` with `schema_validation_failed` | Listing metadata or a route template failed validation. `serviceName` must be printable ASCII, max 64 chars; descriptions are clamped to 256 chars; tags follow the same ASCII rule | Make the name and tags printable ASCII, shorten the description, then settle once more |
| `ownerVerified` was `true`, now reads `false` | The free-tier hosted instance has no persistent disk, so the catalog and its ownership bindings vanish on restart or idle sleep | Nothing to fix. It self-heals after the next settled payment, subject to a 15-minute cooldown |

## Next steps

- [The payment loop](./payment-loop.md) - where settle sits, and why cataloging
  hangs off it
- [Discover services](../buyers/discover-services.md) - querying the catalog
  from a buyer
- [Facilitator](../facilitator.md) - endpoint reference, limits, and the
  discovery query parameters
- [MCP payer](../agent-tooling/mcp-payer.md) - paying for what an agent finds
