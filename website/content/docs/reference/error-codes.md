# Error Codes

> Every error Vellar throws has a name, a cause, and a retryable flag. This is
> the complete reference, the page to bookmark when a payment fails.

By the end of this page you will know what every Vellar error means, whether
retrying is safe, and which errors mean money has already moved on-chain.

## Prerequisites

- Familiarity with the [payment loop](../concepts/payment-loop.md) (verify,
  then settle)
- A wallet with `x402` configured, or a client talking directly to
  `https://vellar-facilitator.onrender.com`
- The facilitator advertises `stellar:testnet` only, so every code below is
  observed on testnet

## How to read an error

Every Vellar error carries at minimum three things:

1. A **class name or code** that is machine-readable. SDK failures are typed
   classes (`MaxAmountExceededError`); facilitator failures are string codes in
   the JSON body (`settle_exact_stellar_transaction_failed`).
2. A **message** that is human-readable and never null.
3. **Context on whether money moved**, which is the only question that matters
   before you retry.

Group the codes by that third property, not by HTTP status. A payment either
never left the client, was refused before submission, or was submitted and
charged fees. Those three states have three different correct responses.

> ⚠️ **Never retry a `PaymentRejectedError` without reading the reason.** If the
> facilitator rejected because an on-chain policy said the payment was over
> budget, nothing moved and a retry (after fixing the budget) is safe. If the
> payment settled and the resource then failed, money already moved and a retry
> pays twice. The class name alone does not tell you which happened; the reason
> it carries does.

## SDK errors (wallet.x402)

These are thrown by the client before or during the payment loop. Every one of
them means nothing was signed or submitted, so no money moved.

| Error | When thrown | Money moved? | Retryable |
| --- | --- | --- | --- |
| `MaxAmountExceededError` | The server asked for more than your `maxAmount`. Nothing was signed. | No | Yes, after raising `maxAmount` or choosing a cheaper resource |
| `DisallowedAssetError` | None of the offered assets appear in your `allowedAssets`. Nothing was signed. | No | Yes, after widening `allowedAssets` or dropping the filter |
| `NoUsablePaymentOptionError` | No offered option matched the scheme and network, or none advertised `areFeesSponsored: true` | No | Yes, against a facilitator that sponsors fees |
| `InvalidRequirementsError` | A payment requirement was malformed, for example a non-integer amount | No | No, the seller's challenge has to be fixed first |
| `PaymentRejectedError` | The facilitator rejected at the verify stage. Carries the reason. | No | Only after reading the reason and fixing the cause |
| `X402NotConfiguredError` | `wallet.x402` used with no `x402` config. From 0.6.1 it is also thrown at construction when `rpcUrl` is missing, empty, or unparseable. | No | Yes, after adding the config |

> **Note:** Amounts are bigints in the asset's base units. Stellar Asset
> Contracts use 7 decimals, so `1_000_000n` is 0.1 units and `10_000_000n` is
> 1.0. A `MaxAmountExceededError` you did not expect is very often a decimals
> mistake rather than a genuinely expensive resource.

## Facilitator errors (/verify and /settle)

These come back from the hosted facilitator as codes in the response body. For
the codes listed below, nothing was spent: an `invalid_*` code is a verify-stage
refusal, a `settle_*` code with an empty `transaction` field means the
transaction was never submitted, and `settlement_refused` is a refusal before
submission. The one case where money did move is a settle failure carrying a
non-empty `transaction`, covered in the taxonomy below.

| Code | Meaning | Money moved? | Fix |
| --- | --- | --- | --- |
| `settle_exact_stellar_transaction_submission_failed` | The transaction was never submitted. Root cause is Soroban RPC answering `TRY_AGAIN_LATER`. | No | Sign a fresh payload and retry once. Signatures expire in ledgers, not wall-clock, so a cached payload will not work. |
| `settle_exact_stellar_transaction_failed` | Same as above: never submitted, nothing spent, a retry cannot double-pay | No | Sign a fresh payload and retry once |
| `settlement_refused`, reason `sponsor_balance_low` | The facilitator's sponsor account is under its hard balance floor. Refuses on every network. | No | Nothing client-side. Wait, or run your own facilitator with a funded sponsor. |
| `settlement_refused`, reason `rate_limited_payto` | A spend-policy refusal keyed to the recipient. Enforced on pubnet only. | No | Slow down, or spread payments across recipients |
| `settlement_refused`, reason `spend_ceiling` | A spend-policy refusal on a cumulative ceiling. Enforced on pubnet only. | No | Wait for the ceiling window, or lower per-request spend |
| `invalid_exact_stellar_payload_authorization_replayed` | The same authorization entry was presented twice | No | Sign a fresh payload; never cache and resend one |
| `invalid_exact_stellar_payload_missing_trustline_recipient` | The seller's `payTo` has no trustline to the payment asset | No | The seller adds a trustline to the asset it advertises |
| `invalid_exact_stellar_payload_unsupported_credential_type` | `simulationSourceAccount` was the payer, so Soroban authorized with source-account credentials | No | Use a different funded classic `G` account. It never signs and is never charged. |
| `fee_exceeds_maximum` | The facilitator's fee ceiling is below the payment's simulated fee | No | Use the Vellar facilitator (500,000 stroops, raisable via `MAX_TX_FEE_STROOPS`) instead of a facilitator defaulting to 50,000 |

> **Note:** Policy-governed payments run the spending-policy contract inside
> `__check_auth`, so they cost more in fees. See
> [Fees and Sponsorship](./fees.md) for measured figures. That extra cost is why
> the reference x402.org facilitator, defaulting to a 50,000-stroop ceiling,
> refuses them with `fee_exceeds_maximum` even though the payment is valid.

## The settle failure taxonomy

The benign settle failure, the one you should retry, arrives as an HTTP 402
rather than a 2xx. If your client classifies purely on status code, that
failure is indistinguishable from a deterministic verify-stage rejection, and
the retry loop you wrote never runs.

Classify on the `transaction` field instead.

| HTTP | settle header | transaction | Meaning | Retry? |
| --- | --- | --- | --- | --- |
| 200 | present | non-empty | Settled | Done, no retry |
| 402 | `success: false` | EMPTY | Failed before submission, nothing spent | YES |
| 402 | `success: false` | non-empty | Submitted, fees charged, failed on-chain | No |
| 402 | absent | n/a | Verify-stage rejection, deterministic | No |

The empty `transaction` field is the signal. The facilitator releases its fee
reservation in exactly that case: no transaction reached the network, so no fee
was charged and re-signing costs nothing. A non-empty hash means the opposite,
that a transaction was submitted and fees were already charged against the
sponsor account, so retrying would burn them a second time without changing the
outcome.

> ⚠️ **Do not branch on the HTTP status alone.** A retryable transient RPC
> failure and a permanent verify rejection both arrive as 402. The pair of
> signals you need is the settle response header plus the `transaction` field.

Since 2026-08-15 the facilitator retries the transient case itself, two attempts
six seconds apart, so you should hit it less often than earlier sessions did.
Keep "sign fresh, retry once" in your client regardless: it costs nothing when
nothing fails.

## Catalog errors (extension-responses header)

On a successful `/settle` only, the facilitator returns a lowercase
`extension-responses` header. It is absent on 400s and on 402 challenges. The
value is JSON keyed by extension name:

```json
{"bazaar":{"cataloged":true}}
{"bazaar":{"cataloged":false,"reason":"unbound_payto"}}
```

A settlement can succeed while cataloging fails. These reasons never affect the
payment.

| Reason | Meaning | Fix |
| --- | --- | --- |
| `no_discovery_extension` | The payment payload carried no discovery extension | Echo `required.extensions` into your payment payload. Skip it and nothing is listed, with no error on either side. |
| `invalid_payto` | The `payTo` in the listing was not a usable Stellar address | Advertise a valid `G` or `C` address |
| `ownership_tombstone_mismatch` | The URL is bound to a different `payTo` than the one settling | Settle from the address that first bound the URL, or use a URL you own |
| `unbound_payto` | The settling `payTo` is not bound to this resource URL | Ownership is trust-on-first-use: the first settled payment binds the URL. On the hosted instance that race reopens after each restart. |
| `schema_validation_failed` | The declared listing metadata or route template failed validation | Fix the `inputSchema` or `routeTemplate`. Invalid or unsafe templates are dropped silently. |
| `binding_refused` | The ownership binding was refused for this settlement | Check that your resource URL answers a 402 with your `payTo` in `accepts[]` |
| `invalid_tool_name` | The declared MCP tool name was not acceptable | Rename the tool to a valid identifier |
| `cataloging_error` | Cataloging failed internally after the payment settled | Retry the cataloging by making another settled payment; the payment itself is unaffected |

> **Note:** Cataloging happens on settle, not on verify. Verify-only traffic
> catalogs nothing, so a resource you only ever verified against will never
> appear in discovery no matter how correct its extension block is.

Two failures that look like errors but are not reported as codes: `serviceName`
must be printable ASCII of at most 64 characters, and a non-ASCII name is
silently dropped rather than transliterated. Descriptions are clamped to 256
characters, and tags follow the same ASCII rule.

## Testnet-specific behavior

The facilitator advertises `stellar:testnet` only, and some refusals behave
differently there.

Four spend-control refusals, `rate_limited_payto`, `rate_limited_url`,
`spend_ceiling`, and `unbound_pool_exhausted`, are logged as would-reject on
testnet but not enforced. The settlement proceeds. That means you cannot test
your handling of a real one on testnet: your error branch will never run there,
however hard you push. They are enforced on pubnet.

`sponsor_balance_low` is the exception: it refuses on every network, so it is
the one `settlement_refused` reason you can actually observe on testnet.

> ⚠️ **A spend-control branch that never fired on testnet is untested code.**
> Write a unit test that feeds your client a synthetic
> `503 {"error":"settlement_refused","reason":"spend_ceiling"}` body rather than
> assuming a live testnet run proved the path works.

There is no mainnet deployment. No mainnet settled hash exists and none is
claimed.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| A paid route returns `200` to `curl -I` | `HEAD` carries no payment challenge, so a correctly wired route looks broken | Debug with `GET`, not `HEAD` |
| The first request hangs roughly 45 seconds | Free-tier cold start; the instance sleeps after 15 minutes idle | Send a warming `GET /health` first, with a generous timeout. `/health` is exempt from the 60 requests/min rate limit. |
| Repeated settles come back with an empty `transaction` field | Transient Soroban RPC `TRY_AGAIN_LATER` | Sign a fresh payload and retry once. Nothing was spent, and a cached payload will not work because signatures expire in ledgers. |

## Next steps

- [Pay for a resource](../buyers/pay-for-a-resource.md) for the happy path these
  errors interrupt
- [Sign and pay](../buyers/sign-and-pay.md) for what happens between `fetch()`
  and the settlement hash
- [The payment loop](../concepts/payment-loop.md) for why verify and settle fail
  differently
- [Bazaar and discovery](../concepts/bazaar-and-discovery.md) for what the
  catalog reasons above are protecting
