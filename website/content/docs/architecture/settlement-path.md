# Settlement Path

> What happens inside the facilitator between receiving a signed payment and
> writing a hash to the ledger. Every step, every check, and what fails where.

By the end of this page you will understand why the facilitator re-simulates a
payment rather than just checking the buyer's signature, how 50 concurrent
settlements avoid sequence-number collisions, why the sponsor is the fee-bump
payer rather than the transaction source, and what the three distinct quantities
called "fee" actually are.

## Prerequisites

This page assumes you know that an x402 payment is a two-call protocol against a
facilitator (`POST /verify`, then `POST /settle`), and that a Vellar buyer may be
either a classic Stellar keypair or a Soroban smart contract account whose
`__check_auth` runs policy contracts. If either is unfamiliar, read
[The payment loop](../concepts/payment-loop.md) first.

Vellar runs on `stellar:testnet` only. The hosted facilitator is
`https://vellar-facilitator.onrender.com`.

## What happens at `/verify`

A failing check returns `isValid: false` with a `reason`. Nothing is submitted
on-chain at any point during verification.

- **Match the payment requirements to a supported scheme and network.**
  `GET /supported` lists exactly what is accepted, so a client can check this
  itself before ever calling `/verify`.
- **Re-simulate the transaction against the chain.** This is the critical step.
  Simulation runs the buyer's `__check_auth`, and therefore runs any
  spending-limit policy registered inside it. A payment that would fail on-chain
  is caught here, before any funds move.

The fee bid is checked separately against `MAX_TX_FEE_STROOPS` on the settlement
path: if the bid exceeds the ceiling, settlement is refused before submission
with `fee_exceeds_maximum`.

> **Note:** A signature check only proves the buyer signed something. It proves
> nothing about whether that something can succeed. Re-simulation proves the
> transaction would actually execute on-chain right now, under current chain
> state, including the policy's current window balance. A buyer whose spending
> limit has 0.05 USDC of headroom left this window carries a perfectly valid
> signature over a 1 USDC payment. Only simulation catches that.

## Why the facilitator builds the transaction

The buyer does not sign a transaction. The buyer signs an **authorization
entry**, which authorizes one specific transfer with `from`, `to` and `amount`
fixed at signing time.

The facilitator builds the transaction around that signed entry:

- It sets a **channel account** as the transaction source.
- It attaches the buyer's signed auth entry.
- It fee-bumps the result with the **sponsor** account,
  `GBUCR6H22CZC5OYHBJIEUS2JFZBOB63AHEGTCV6UEPMD2TMLKG2ZMIW4`.

The consequence is structural rather than promised: the buyer's address never
appears as a transaction source and never appears as a fee payer. That is what
non-custodial fee sponsorship means here. You do not have to take the claim on
faith, because Horizon shows both fields on every settled transaction. See
[Fees and sponsorship](../reference/fees.md) for the verification commands.

## What happens at `/settle`

1. **Check the sponsor balance against the hard floor.** If the sponsor is below
   `SPONSOR_HARD_FLOOR_STROOPS` (default 100,000,000 stroops, 10 XLM), `/settle`
   refuses with `503 settlement_refused` and reason `sponsor_balance_low`, before
   submitting anything. Nothing is spent.
2. **Acquire a channel account from the 50-account pool.** Each settlement holds
   one channel account exclusively for the duration. This is what prevents
   sequence-number collisions when settlements run concurrently: two settlements
   never build against the same account's sequence number. See
   [The channel pool](./channel-pool.md) for how the pool is sized, funded, and
   enforced at boot.
3. **Submit the fee-bumped transaction.** The channel account is the inner
   transaction source, the sponsor is the fee-bump payer. On the ledger that
   reads as `source_account` = the channel account (for example
   `GBG5UKF4EXHYOFQFHOO263NTZRFUSXKBRUOAPDZEKISA7CPLABH7ONV4`) and `fee_account`
   = the sponsor.
4. **On success, run the Bazaar catalog hook.** Cataloging happens on settle, not
   on verify. A cataloging failure never affects the settlement result: the
   payment stands regardless, and the reason is reported separately in the
   `extension-responses` header. See
   [Catalog integrity](./catalog-integrity.md).
5. **On failure with an empty `transaction` field**, the transaction was never
   submitted and nothing was spent. The channel account is released back to the
   pool and a retryable error is returned:
   `settle_exact_stellar_transaction_submission_failed` or
   `settle_exact_stellar_transaction_failed`. Sign a fresh payload and retry. A
   retry cannot double-pay, because there is nothing to double.
6. **On failure with a non-empty `transaction` field**, fees were charged and the
   transaction failed on-chain after submission. This is terminal. Do not retry.
   The hash is surfaced precisely so the payment stays traceable.

The root cause of the empty-`transaction` case is that Soroban RPC occasionally
answers `TRY_AGAIN_LATER` to a valid transaction. Since 2026-08-15 the
facilitator retries internally (two attempts, 6 seconds apart) before returning
the error, so clients see it less often than earlier sessions did.

> ⚠️ **The `transaction` field is the retry decision, not the error code.**
> Branch on whether the field is empty. Empty means nothing was spent and a
> retry is safe; non-empty means fees were charged and a retry pays twice.

## The three quantities called "fee"

Three different numbers get called "the fee" and they have three different
consumers. Confusing them is the most common source of fee debugging pain.

| Quantity | What it is | Who consumes it |
| --- | --- | --- |
| **CHARGED** (`fee_charged`) | What the sponsor actually paid, visible on Horizon. Measured: 23,059 stroops for a plain keypair settle, 85,999 for a policy-governed smart-account settle, 39,949 for an `upto` settlement. | The sponsor balance guard (soft floor 250,000,000 stroops, hard floor 100,000,000 stroops) |
| **BID** (`minResourceFee` + `BASE_FEE`) | What the facilitator offers before submission. A policy-governed payment bids roughly 130,000 stroops. Never visible externally. | The fee ceiling, `MAX_TX_FEE_STROOPS` (default 500,000) |
| **ESTIMATE** | A flat 500,000 stroops, an accounting constant for spend-ceiling tracking. Not a measurement of anything. | The rolling spend ceiling, `SPEND_CEILING_STROOPS` (default 50,000,000 per window) |

The charged fee runs consistently below the bid because simulation over-reserves:
it bids high enough that the transaction is certainly accepted, and the network
then charges what the execution actually cost.

> ⚠️ **The ceiling is compared against the bid, never the charge.** A
> policy-governed payment bidding roughly 130,000 stroops is refused outright by
> a facilitator with a 100,000 stroop ceiling, even though the charge would have
> been 85,999 stroops. This is not hypothetical: the reference `x402.org`
> facilitator defaults to a 50,000 stroop ceiling and therefore rejects
> policy-governed payments with `fee_exceeds_maximum`. Vellar defaults to
> 500,000.

Because the spend ceiling is accounted at the ESTIMATE rather than the actual
charge, it trips after roughly 100 settlements per window while having spent
about 0.23 XLM of the 5 XLM it names. That is a known open item for pubnet
tuning. It is deliberately left conservative because it fails safe: it refuses
early rather than overspending.

[Fees and sponsorship](../reference/fees.md) has the full breakdown with the
verified Horizon figures and the commands to reproduce them.

## What cannot fail silently

The settlement path is built so that refusals are loud and cheap, and so that a
refusal never leaves the buyer charged:

- **A rejection carries a `reason`** in the response body, rather than a bare
  failure flag on its own.
- **A sponsor below the hard floor refuses `/settle` before submission.** The
  facilitator does not submit transactions it expects to fail for lack of funds.
- **A fee bid above `MAX_TX_FEE_STROOPS` refuses before submission.** Nothing is
  spent on a ceiling refusal.
- **An empty `transaction` field on a `/settle` failure means nothing was
  submitted.** The absence of a hash is itself the signal that a retry is safe.

> ⚠️ **HTTP 200 does not mean the payment succeeded.** `/verify` returns
> `isValid: false` and `/settle` returns `success: false` inside an HTTP 200
> response. A client that branches on the status code alone will treat a rejected
> payment as a successful one and hand over the goods for nothing. Always branch
> on the response body.

Spend-control refusals (`rate_limited_payto`, `rate_limited_url`,
`spend_ceiling`, `unbound_pool_exhausted`) are enforced on pubnet and log-only on
testnet, so you cannot exercise your handling of a real one against the hosted
instance. `sponsor_balance_low` refuses on every network.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `isValid: false` with a simulation failure | Re-simulation ran the buyer's `__check_auth` and it did not succeed under current chain state, commonly a spending-limit policy with insufficient window headroom | Check the policy's remaining budget for the current window, or wait for the tumbling window to reset. See [Spending policies](./spending-policies.md) |
| `503 settlement_refused` with `sponsor_balance_low` | The sponsor account is below `SPONSOR_HARD_FLOOR_STROOPS` (100,000,000 stroops) | Nothing was spent. Retry once the operator has funded the sponsor. If you run your own, see [Configuration](../operators/configuration.md) |
| `fee_exceeds_maximum` | The fee **bid** (not the charge) exceeded `MAX_TX_FEE_STROOPS`. Typically a policy-governed payment bidding roughly 130,000 stroops against a 50,000 ceiling | Nothing was spent. Use a facilitator with a 500,000 stroop ceiling, or raise `MAX_TX_FEE_STROOPS` on your own |
| `/settle` failure with an **empty** `transaction` field | Never submitted, usually a Soroban RPC `TRY_AGAIN_LATER` that survived the two internal retries | Nothing was spent and a retry cannot double-pay. Sign a fresh payload and retry |
| `/settle` failure with a **non-empty** `transaction` field | Submitted, fees charged, failed on-chain. A seller `payTo` missing a trustline to the payment asset produces this and reads exactly like a spend control refusing it | Terminal. Do not retry. Look up the surfaced hash on Horizon, and check the seller's trustline first |

## Next steps

- [Fees and sponsorship](../reference/fees.md)
- [The channel pool](./channel-pool.md)
- [Conformance](../reference/conformance.md)
- [Running a facilitator](../operators/run.md)
