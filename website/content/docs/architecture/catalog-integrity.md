# Catalog Integrity

> How the Bazaar catalog prevents three attack classes: spam from unpaid
> resources, URL squatting from a different payTo, and metadata injection from
> seller-supplied text.

By the end of this page you will understand why cataloging is gated on
settlement rather than registration, how the trust-on-first-use ownership
binding works and what it cannot prevent, and what the F11 controlled A/B test
actually demonstrated.

## Why settlement-gating prevents spam

A resource enters the catalog only after a real payment settles for it. There is
no registration endpoint, no submission form, and no way to list a resource by
asserting that it exists. Cataloging is a hook on `/settle`.

That makes spam expensive in the only currency that cannot be faked. To place
one entry in the catalog you must move real funds on-chain to the `payTo`
address in that entry's own payment challenge. To place a thousand entries you
must do it a thousand times. The cost of an attack scales linearly with its
size, and the attacker pays it.

It also makes the trust block honest by construction. `settlements` is a count
of settlements the facilitator observed, and `uniquePayers` is the number of
distinct accounts that actually paid. Neither is a self-reported number, because
there is no field a seller could put a self-reported number into. The
`observedSettlements` and `statsSource` fields record whether those stats were
observed live or restored from persistence, so a consumer can tell the
difference.

> **Note:** Cataloging happens on settle, not on verify. A client that calls
> `/verify` without ever calling `/settle` catalogs nothing, and no error is
> returned on either side: the verify succeeds and the catalog stays empty.
> Buyers building their own client must echo `required.extensions` into the
> payment payload, or the discovery extension never reaches the settle hook.

## Trust-on-first-use ownership

The first settled payment for a resource URL binds that URL to the `payTo`
address it paid. That binding is what a later settlement is checked against: a
different `payTo` settling the same URL is refused from the catalog, while the
payment itself still goes through on-chain.

The binding is not taken on trust from the payload. The facilitator verifies it
by fetching the URL itself: it sends an unauthenticated GET and confirms the
address appears in the 402 challenge the resource serves. If the resource does
not vouch for the address, `ownerVerified` is `false`.

Five requirements are checked in order. Any one failing gives `unverifiable`.

| # | Requirement | Notes |
| --- | --- | --- |
| 1 | `https` and publicly resolvable | `http` is rejected before a socket opens; loopback, private ranges and cloud-metadata addresses are refused |
| 2 | An unauthenticated GET returns 402 | A 200 or a 401 is unverifiable |
| 3 | Carries a `PAYMENT-REQUIRED` header of 64 KiB or less | The verdict comes entirely from the header; the body is never downloaded |
| 4 | The challenge's `accepts[].payTo` includes your address | This is the actual ownership check |
| 5 | Answers within 3 seconds with no redirect | A 301 from `/quote` to `/quote/` reads as unverifiable |

Two mistakes account for most `unverifiable` verdicts: advertising `localhost`
instead of a public URL, and a trailing-slash mismatch, since the canonical
catalog key strips the trailing slash. See
[Bazaar and discovery](../concepts/bazaar-and-discovery.md).

## The F11 finding

The ownership hijack was not reasoned about in the abstract. It was reproduced,
fixed, and then re-run against the fix in a controlled A/B test on 2026-08-08
UTC: four transactions, the same accounts, the same URL, with only the code
differing between the pairs. All four settled successfully, each charging
`fee_charged` 23,067 to the F11 test sponsor
`GBOC2UOB7UI3LW2JDRSJQVCGI7SN7QD7AWELYCSNFY6GEWD4EPED6U3Y`.

| # | What happened | Hash | Ledger |
| --- | --- | --- | --- |
| Pre-fix #1 | Legitimate settle to merchant A | `f7ea48f3070e9ad7e04bb61ffc95433ec4b0fac59befa74078ffad985603d0a2` | 4040686 |
| Pre-fix #2 | Hijack succeeded: catalog entry overwritten | `d56dc927a7c7c019197017b6a3dd92c198d9dce0d9d35749d8dbc896d0c4160d` | 4040689 |
| Post-fix #1 | Legitimate settle to merchant A | `c16af8224c474901b8fbf513b839926ddfb50707dc283a19f5f8629a24f028b3` | 4040704 |
| Post-fix #2 | Identical attack refused by TOFU: catalog unchanged | `a909e4748c83f55972d6cee3286b8627c304b231037c7daae51d869bf17f1d38` | 4040706 |

Pre-fix, the second settlement overwrote the catalog entry and the attacker
inherited the legitimate seller's accumulated trust stats. That is the sharp
edge of the vulnerability: the stolen asset was not the payment, it was the
history behind the listing.

Post-fix, the identical attack was refused by the TOFU binding and the catalog
entry was unchanged. The attacker's payment still settled on-chain.

> ⚠️ **"Blocked" means the catalog protected the seller, not that the payment
> failed.** Post-fix #2 is a successful on-chain settlement. The facilitator
> does not and cannot stop someone from paying an address they control. What it
> stops is that payment rewriting somebody else's listing.

The control run is what makes this verifiable rather than asserted. Without the
pre-fix pair showing the hijack actually working against the same accounts and
the same URL, "blocked" would be indistinguishable from a settlement that broke
for unrelated reasons. All four hashes are listed on
[Proofs](../reference/proofs.md) and resolve independently on Horizon.

## What TOFU cannot prevent

Trust-on-first-use protects whoever is first. It does not establish who ought to
have been first.

If an attacker settles a payment for your URL before you do, they hold the
binding. Your own settlements for your own resource are then refused from the
catalog, and your payments still go through on-chain. The `ownerVerified` check
limits how far this goes, since the attacker's address will not appear in the
402 challenge your resource actually serves, but the binding itself is theirs
until the entry is cleared.

On the free-tier hosted instance there is no persistent disk, so entries and
ownership bindings vanish on every restart or idle sleep. That has a
double-edged consequence: a stale or hostile binding does not last forever, but
the first-settler race reopens after every cold start rather than being won
once. A resource re-catalogs after its next settled payment, and `ownerVerified`
self-heals after the next settlement with a 15-minute cooldown.

> ⚠️ **Be first to settle for your own URL.** The binding goes to the first
> settlement observed, not to the party who registered, deployed, or owns the
> domain. On the hosted instance that race reruns after each restart, so a
> seller who wants a durable binding should run their own facilitator instance
> with a persistent disk.

## Metadata protections

Everything in a catalog entry except the trust block is text supplied by whoever
settled the payment. It is treated as attacker-influenced by default and
sanitised at ingest:

- `serviceName` must be printable ASCII, 64 characters maximum. A non-ASCII name
  is silently dropped rather than transliterated, because transliteration would
  invent a name nobody chose.
- Descriptions are clamped to 256 characters.
- Tags follow the same printable-ASCII rule.
- `routeTemplate`, which declares the URL shape of a parameterized route, is
  validated by `extractDiscoveryInfo` from `@x402/extensions`. Invalid or unsafe
  templates are dropped silently. A dropped template surfaces as
  `schema_validation_failed` in the `extension-responses` header.

Each field is sanitised individually before the fields are joined. A newline
smuggled into one value therefore cannot forge an extra field: by the time
values are combined, none of them can contain a separator.

Templated routes stay in the catalog but are permanently `ownerVerified: false`,
because a template is not a fetchable URL and requirement 4 above has nothing to
fetch. That is a limitation stated plainly rather than papered over with a
weaker check.

Cataloging never affects settlement. A rejected template, a dropped name, or a
refused binding changes what appears in the catalog and nothing about whether
the payment went through.

What sanitisation does not do is make the remaining text trustworthy. A
description that survives the clamp is still written by the seller, and a
consumer reading it should treat it as a claim. The fields that cannot be forged
through metadata are the ones that were never supplied by the client at all:
`settlements` and `uniquePayers` are counted from observed on-chain activity,
which is why they are the fields worth ranking and filtering on. Agents reading
this text have a separate concern, prompt injection, covered in
[Threat model](./threat-model.md).

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `binding_refused` in the `extension-responses` header | A different `payTo` already holds the TOFU binding for that URL | The payment settled; the catalog did not update. Confirm you are the first settler for that exact URL, or run your own instance |
| `ownerVerified` stays `false` permanently | The advertised URL is `localhost` or `http`, which fails requirement 1 before a socket opens | Advertise a public `https` URL that serves the 402 challenge |
| A `serviceName` is missing from the entry | Non-ASCII characters, so the field was silently dropped rather than transliterated | Use printable ASCII, 64 characters or fewer |
| `schema_validation_failed` in the `extension-responses` header | An invalid or unsafe `routeTemplate` was dropped | Fix the template shape. The settlement itself was unaffected |
| The catalog is empty after a restart | The hosted free tier has no persistent disk, so entries and bindings reset on restart or idle sleep | Re-catalog with a settled payment, or run your own instance with persistence |

## Next steps

- [Bazaar and discovery](../concepts/bazaar-and-discovery.md)
- [Get discovered](../sellers/get-discovered.md)
- [Proofs](../reference/proofs.md)
- [Threat model](./threat-model.md)
