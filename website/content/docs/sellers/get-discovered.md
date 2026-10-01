# Get Discovered

> `ownerVerified: true` is the signal that tells agents your listing is not a squat. This page explains exactly how to get it, keep it, and what the trust fields in your catalog entry mean.

By the end of this page you will understand the five requirements for
`ownerVerified`, how to check your own listing from the command line, what to do
if someone else settles your URL first, and which trust fields in your catalog
entry are worth reading.

## Prerequisites

- A publicly deployed seller endpoint over **https**. A `localhost` URL cannot
  pass ownership verification, ever.
- At least one real payment settled through the Vellar facilitator
  (`https://vellar-facilitator.onrender.com`, `stellar:testnet` only).
  `ownerVerified` is computed after settlement, not at registration, and there
  is no registration step to begin with.
- `curl` and `python3` for the inspection commands below.

> **Note:** The hosted facilitator runs on a free tier and sleeps after 15
> minutes idle. The first request after a sleep takes roughly 45 seconds
> (measured). That is a cold start, not a failure.

## 1. The five requirements for ownerVerified

`ownerVerified: true` means the facilitator fetched your resource URL itself and
found your `payTo` inside your own 402 challenge. The facilitator computes it
with no external dependency: nothing else has to be up, and no attestation
service is consulted.

Five things must be true, checked in this order. Any one of them failing gives
`unverifiable`.

| # | Requirement | Why |
| --- | --- | --- |
| 1 | **https** and publicly resolvable | http is rejected before a socket opens; loopback, private ranges and cloud-metadata addresses are refused |
| 2 | An **unauthenticated `GET` returns 402** | The verifier sends no payment, so a 200 or a 401 is unverifiable |
| 3 | Carries a `PAYMENT-REQUIRED` header of **64 KiB or less** | The verdict comes entirely from the header; the body is never downloaded |
| 4 | The challenge's `accepts[].payTo` **includes your address** | This is the actual check |
| 5 | Answers within **3 seconds** with **no redirect** | Redirects are not followed, so a `301` from `/quote` to `/quote/` reads as unverifiable |

Because the verdict comes entirely from the `PAYMENT-REQUIRED` header, an
expensive body on your paid route costs the verifier nothing. Requirement 3
caps the header, not the response.

> ⚠️ **Debug a paid route with `GET`, never `HEAD`.** `curl -I` returns a plain
> 200 because a `HEAD` response carries no payment challenge. Use
> `curl -s -i` so you see the 402 and its header.

```bash
curl -s -i "https://vellar-seller-demo.onrender.com/quote" | head -20
```

## 2. Two mistakes that catch everyone

**Advertising `localhost` instead of a public URL.** The `resource.url` in your
402 challenge is what gets cataloged and what the verifier re-fetches later. If
that field says `http://localhost:4021/quote` because you copied a development
config into production, the catalog stores the loopback address and requirement
1 rejects it on every re-check. Set the advertised URL to your public https
origin, not to whatever your process happens to bind locally.

**A trailing-slash mismatch.** The canonical catalog key strips a trailing
slash, so a resource advertised as `/quote/` is stored and re-fetched as
`/quote`. A server that only answers `/quote/` and redirects `/quote` to it
fails requirement 5, because redirects are not followed. Serve the challenge at
the exact canonical URL with no redirect in front of it.

## 3. Check if you are verified

List the catalog and print each resource with its `ownerVerified` value:

```bash
curl -s "https://vellar-facilitator.onrender.com/discovery/resources?limit=100" \
  | python3 -c '
import json, sys
data = json.load(sys.stdin)
for item in data["items"]:
    trust = item.get("trust") or {}
    print(item.get("resource"), "ownerVerified=", trust.get("ownerVerified"))
print("total:", data["pagination"]["total"])
'
```

`limit` defaults to 20 and caps at 100, and `offset` (default 0) pages through
the rest. You can narrow the list with `payTo` to see only your own entries.

Then read the catalog's own health:

```bash
# unverifiableEntries is ABSENT when zero, not 0. Check for presence, not value:
# if the key is missing, nothing is currently unverifiable, which is healthy.
# reverifyPending > 0 means ownership checks are still in flight after a
# restart, so check back shortly rather than treating what you read as final.
curl -s "https://vellar-facilitator.onrender.com/health" | python3 -m json.tool
```

`/health` also reports `catalogFrozen`, which tells you whether the catalog has
stopped accepting writes. It is exempt from the 60 requests/min per IP rate
limit, so it is also the right endpoint to warm a sleeping instance with before
a real request.

## 4. Be first to settle for your URL

URL ownership is trust-on-first-use. The first settled payment for a resource
URL binds that URL to that payment's `payTo`. A different `payTo` settling the
same URL afterwards is refused from the catalog: the catalog entry is not
updated, though the payment itself still settles on-chain exactly as signed.

That refusal shows up as `binding_refused` in the `extension-responses` header
returned on a successful `/settle`:

```json
{"bazaar":{"cataloged":false,"reason":"binding_refused"}}
```

> ⚠️ **If someone else settles your URL first, they hold the binding.** Your own
> settlements for that URL are then refused from the catalog even though your
> payments go through and the money moves normally. There is no admin override
> and no support queue, so make the first settlement for a URL yourself, from
> the `payTo` you intend to keep, before you publish the endpoint anywhere.

> **Note:** On the hosted free-tier instance the first-settler race reopens
> after each restart, because ownership bindings are not persisted. That cuts
> both ways: a squatted binding clears on its own, and so does yours.

The practical routine is to settle one small payment against your own endpoint
immediately after each deploy. The demo seller charges 0.1 testnet USDC
(`1_000_000` atomic units at 7 decimals) and is a useful shape to copy.

## 5. What your catalog entry contains

A catalog entry carries the resource URL, the payment options a buyer can pay
with, and a trust block the facilitator assembled from what it observed.

```json
{
  "resource": "https://vellar-seller-demo.onrender.com/quote",
  "accepts": [
    {
      "scheme": "exact",
      "network": "stellar:testnet",
      "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      "amount": "1000000",
      "payTo": "G... your seller account"
    }
  ],
  "trust": {
    "settlements": 12,
    "uniquePayers": 4,
    "observedSettlements": 12,
    "statsSource": "observed",
    "ownerVerified": true,
    "verification": "unknown",
    "acceptsVerification": "unknown"
  }
}
```

| Field | What it means | Use it? |
| --- | --- | --- |
| `settlements` | Count of observed on-chain settlements for this resource | Yes |
| `uniquePayers` | Distinct accounts that have paid it | Yes |
| `observedSettlements` | Settlements this process watched land itself | Yes, more reliable than `settlements` on restored entries |
| `statsSource` | Provenance of the stats: `"observed"` (watched live by this process) or `"persisted"` (restored) | Yes, it tells you how much to trust the two counts above |
| `ownerVerified` | The facilitator fetched the URL and found this `payTo` in the challenge | Yes, this is the signal |
| `verification` | Always `"unknown"` | No |
| `acceptsVerification` | Always `"unknown"` | No |

`verification` and `acceptsVerification` are always `"unknown"` on every
deployment. They read from an external attestation service that is deployed
nowhere. That is architectural, not an outage, and it will not change on its
own.

> ⚠️ **Do not tell buyers to filter your listing with `verified_only=true`.** It
> filters on `verification`, which can never be anything but `"unknown"` here.
> Rather than silently returning an empty list, the facilitator refuses the
> filter outright with
> `400 {"error":"verified_only_unavailable","reason":"no_verdict_source_configured"}`,
> and the refusal names `ownerVerified` as the signal that does work.

## 6. Keeping the badge

> **Note:** On the free-tier hosted instance `ownerVerified` is lost on every
> restart, because there is no persistent disk: catalog entries and ownership
> bindings both vanish on a restart or an idle sleep. It self-heals with no
> operator involvement, because the next settled payment for that resource
> re-runs the ownership check, subject to a 15-minute cooldown. A `false` value
> there is usually a restart signal, not a squat signal.

The consequence for you as a seller is that "get verified once" is not the
model. Keep a small heartbeat payment against your own endpoint, or simply
accept that the badge returns after your next real customer pays.

## 7. Metadata that gets dropped

Every field in a listing arrives at the facilitator by way of a client, which
echoes the resource block into the payment payload. The facilitator therefore
treats all of it as attacker-influenceable and sanitizes it at ingest:

- `serviceName` must be printable ASCII, maximum 64 characters. A non-ASCII
  name (non-Latin script, emoji) is **silently dropped**, not transliterated.
- Descriptions are clamped to 256 characters.
- Tags follow the same printable-ASCII rule.

A dropped field surfaces as `schema_validation_failed` in the
`extension-responses` header:

```json
{"bazaar":{"cataloged":false,"reason":"schema_validation_failed"}}
```

That header is lowercase and is returned on a successful `/settle` only. It is
absent on 400s and on 402 challenges, so a payment succeeding is not evidence
that your listing was written. Read the header to confirm.

**Route templates.** `routeTemplate` declares the URL shape of a parameterized
route, for example `"/inspect/{address}"`, so an agent can construct a call
instead of guessing. Validation is handled by `extractDiscoveryInfo` from
`@x402/extensions`, and invalid or unsafe templates are dropped silently.
Cataloging never affects settlement either way.

> ⚠️ **A templated route is permanently `ownerVerified: false`.** It stays in
> the catalog and remains discoverable, but a template is not a fetchable URL,
> so the facilitator can never run the five checks against it. Do not read that
> `false` as a squat, and do not try to fix it: if you want a verified badge,
> also list a concrete https URL that answers 402 on its own.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `ownerVerified` stuck `false` | The advertised `resource.url` is `localhost`, another loopback or private address, or plain http. Requirement 1 rejects it before a socket opens | Advertise your public https origin in the 402 challenge, redeploy, then settle once |
| `ownerVerified` stuck `false` on a working public seller | Trailing-slash mismatch: the canonical key strips the trailing slash, so a server answering only `/quote/` is checked at `/quote`, and the `301` is not followed | Serve the challenge at the exact canonical URL with no redirect in front of it |
| `ownerVerified` stuck `false`, URL looks right | An unauthenticated `GET` returns 200 or 401 instead of 402, so requirement 2 fails. Check with `curl -s -i`, never `curl -I` | Make the unpaid route return 402 with a `PAYMENT-REQUIRED` header of 64 KiB or less |
| `ownerVerified` was `true`, now reads `false`, repeatedly | The free-tier hosted instance has no persistent disk, so the catalog and its bindings vanish on restart or idle sleep | Nothing to fix. It self-heals after the next settled payment, subject to a 15-minute cooldown |
| `cataloged: false` with `binding_refused` | The URL is already bound to a different `payTo` under trust-on-first-use | Settle from the bound `payTo`, or settle again after a restart clears the binding on the hosted instance. Your payments were unaffected throughout |
| `cataloged: false` with `schema_validation_failed` | Listing metadata or a route template failed validation: a non-ASCII `serviceName`, a name over 64 chars, or an over-long description | Make the name and tags printable ASCII, shorten the description to 256 chars, then settle once more |

## Next steps

- [Charge for an endpoint](./charge-for-an-endpoint.md) - the 402 challenge your
  listing is derived from
- [Up-to metered payments](./upto-metered-payments.md) - charging less than the
  signed ceiling
- [Bazaar and discovery](../concepts/bazaar-and-discovery.md) - how cataloging
  hangs off settle, and every `extension-responses` reason value
- [Discover services](../buyers/discover-services.md) - what a buyer sees when
  they read your entry
