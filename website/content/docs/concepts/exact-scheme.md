# The Exact Scheme

> Fixed-price settlement on Stellar. The buyer signs a Soroban authorization entry for one amount to one recipient, valid until one specific ledger.

By the end of this page you will understand what the buyer actually signs in an
`exact` payment, why expiration is measured in ledgers rather than wall-clock
seconds, which five checks the facilitator runs before anything settles, and how
to verify fee sponsorship independently on-chain instead of taking the
facilitator's word for it.

## Prerequisites

- A working grasp of the [payment loop](./payment-loop.md) (402 challenge, signed
  payload, verify, settle)
- Familiarity with Stellar's two address types: `C...` smart accounts and `G...`
  classic keypairs (see [Stellar essentials](./stellar-essentials.md))
- `curl` and `python3` available locally for the verification step

## What the buyer signs

The buyer does not sign a transaction. The buyer signs a **Soroban authorization
entry** that permits exactly one `transfer()` call on the payment asset's
contract, with three fields fixed:

- `from`: the buyer's address (a `C...` smart account or a `G...` classic
  keypair, the facilitator settles from both)
- `to`: the seller's `payTo` address, exactly as declared in the 402 challenge
- `amount`: exactly the declared amount, in the asset's base units

The signature covers all three fields together. Change any one of them after
signing, redirect the transfer to a different recipient, round the amount up,
swap the payer, and the signature no longer validates. The facilitator checks
this at `POST /verify` before anything settles, so a tampered payload is refused
rather than partially executed.

Amounts are bigints in the asset's base units. Stellar Asset Contracts use 7
decimals, so `1_000_000n` is 0.1 units and `10_000_000n` is 1.0.

> ⚠️ **The authorization entry is not a transaction.** The facilitator builds the
> Stellar transaction around your signed entry and sets **its own account** as
> the transaction source. The buyer never submits a transaction to the network
> and never pays a network fee. What the buyer authorizes is a transfer; what
> gets submitted is the facilitator's transaction carrying that authorization.

## Ledger-based expiration

> ⚠️ **Signatures expire in ledgers, not seconds.** An authorization entry is
> valid only up to a specific **ledger sequence number**. Testnet closes a ledger
> roughly every 5 seconds. Once that ledger passes, both verify and settle fail,
> and the same payload can never be retried: you must sign a fresh one.

The expiration ledger is derived from the seller's declared
`maxTimeoutSeconds` in the 402 challenge, converted into a ledger offset added to
the current ledger at signing time.

Two consequences follow from this being a ledger count rather than a clock:

**Do not cache signed payloads.** A payload that sat in a queue, a retry buffer,
or a log for a few minutes is dead on arrival. Retrying it is not a
double-payment risk, it simply fails at verify. Re-sign instead.

**Give `maxTimeoutSeconds` headroom.** Ledger close times drift. On a congested
testnet, ledgers can close slower or faster than the nominal 5 seconds, so the
wall-clock window a given ledger offset buys you is not fixed. The timeout has to
cover the whole round trip: the buyer's simulation, the retry request to the
seller, the facilitator's verify, and the settle submission. A value tuned to a
perfect network leaves nothing for the facilitator's cold start, and the hosted
facilitator's first call after idle sleep can take 30 to 90 seconds and
occasionally up to 2 minutes.

The [`upto`](./upto-scheme.md) scheme adds a separate contract-enforced ceiling
on top of this: `expiration_ledger` must not exceed `current_ledger + 17,280`
(about 24 hours at 5s per ledger). That ceiling is `upto` specific and does not
apply to `exact`.

## What the facilitator checks

Before settling an `exact` payment, the facilitator verifies the following. Any
one of them failing refuses the payment, and nothing is spent.

1. **The signature is valid over the exact declared transfer fields.** The entry
   is re-checked against `from`, `to` and `amount` as declared. For a Vellar
   smart account this happens by re-simulation, which runs the account's
   `__check_auth` and therefore any attached [policy](../policies.md).
2. **The authorization matches the declared scheme, asset, amount and
   recipient.** A payload that authorizes a different token contract, a different
   amount, or a different `payTo` than the challenge asked for is refused.
3. **The authorization has not been used before.** Replay protection: an entry
   that already settled cannot settle a second time.
4. **The authorization has not expired.** The current ledger must still be at or
   below the entry's expiration ledger.
5. **The facilitator advertises `areFeesSponsored: true` for this scheme and
   network.** The exact scheme requires sponsored fees, and the SDK also enforces
   this client-side during option selection, throwing
   `NoUsablePaymentOptionError` if no offered option advertises it.

## Non-custodial settlement

Buyer funds move directly from the buyer's address to the seller's `payTo`. The
facilitator is the transaction source and the fee payer, and nothing more. It
never takes custody of the payment amount, never holds an intermediate balance,
and cannot redirect the transfer, because the recipient is one of the three
fields the buyer's signature covers.

You do not have to take that on trust. The first settlement on the hosted
instance is a public Stellar testnet transaction, and Horizon will tell you who
paid the fee:

```bash
HASH=1da6f9e6a90b78da898c99dfefba8821b5f632b72f584968fb057fd8a298e039

curl -s "https://horizon-testnet.stellar.org/transactions/$HASH" \
  | python3 -c 'import json,sys; t=json.load(sys.stdin); print("successful:", t["successful"]); print("fee_account:", t["fee_account"]); print("ledger:", t["ledger"])'
```

Expected output:

```
successful: True
fee_account: GBUCR6H22CZC5OYHBJIEUS2JFZBOB63AHEGTCV6UEPMD2TMLKG2ZMIW4
ledger: 3898493
```

`fee_account` is the facilitator's sponsor account, not the buyer's address. The
`fee_charged` on that transaction was 28,711 stroops, and the buyer's XLM balance
was untouched. That is what makes `areFeesSponsored` demonstrated on-chain rather
than asserted in a JSON field.

The same holds across the e2e suite: six settlements run against the live
facilitator on consecutive ledgers 4561546 to 4561571 each charged 23,059 stroops
to the same sponsor account, never to the buyer.

> **Note:** `areFeesSponsored: true` inside a kind's `extra` object in
> `GET /supported` means the facilitator pays the Stellar network fee from its own
> sponsor account, so the buyer needs no XLM at all. Both Vellar schemes advertise
> it. The SDK reads the flag during option selection and refuses any option that
> does not carry it, so a buyer is never silently put in a position of owing a
> network fee it cannot pay.

You can inspect any settlement hash the same way, or open it in the explorer at
[explorer.vellar.xyz](https://explorer.vellar.xyz).

## When it fails

| Error | Cause | Fix |
|---|---|---|
| `invalid_exact_stellar_payload_authorization_replayed` | The same authorization entry was already settled once. Replay protection refused the second attempt. | Sign a fresh payload. A retry of a settled payload can never succeed, by design. |
| Expired authorization (verify-stage refusal) | The entry's expiration ledger has passed. Usually a cached payload, a slow round trip, or a facilitator cold start eating the window. | Sign fresh and raise `maxTimeoutSeconds` so the ledger offset covers the whole round trip. |
| `invalid_exact_stellar_payload_missing_trustline_recipient` | The seller's `payTo` has no trustline to the payment asset. The payment verifies successfully, then fails at settlement. | The seller must add a trustline for that asset. Note this reads almost exactly like a spend control refusing the payment, so check the recipient before blaming your policy. |
| `invalid_exact_stellar_payload_unsupported_credential_type` | `simulationSourceAccount` is the payer's own address, so Soroban authorized with source-account credentials instead of the smart account's auth entry. | Use a **different** funded classic `G...` account for `simulationSourceAccount`. It never signs and is never charged. |
| `fee_exceeds_maximum` | The facilitator's sponsored-fee ceiling is below what the payment costs. Policy-governed payments raise the simulation-derived fee to roughly 130,000 stroops (worst measured settlement on testnet: 127,808), while the reference `x402.org` facilitator defaults to 50,000. | Use a facilitator with a raised ceiling. Vellar ships 500,000 stroops, raisable via `MAX_TX_FEE_STROOPS`. |

Two settlement failures deserve a separate note, because they look alarming and
are not: `/settle` can return an empty `transaction` field with
`settle_exact_stellar_transaction_submission_failed` or
`settle_exact_stellar_transaction_failed`. Both mean the transaction was never
submitted, nothing was spent, and a retry cannot double-pay. The root cause is
Soroban RPC answering `TRY_AGAIN_LATER`; since 2026-08-15 the facilitator retries
this itself (two attempts, 6 seconds apart). Sign a fresh payload and retry,
because the old signature has been burning ledgers the whole time.

## Next steps

- [The payment loop](./payment-loop.md) for the full 402 challenge to settlement
  round trip
- [The upto scheme](./upto-scheme.md) for metered pricing where the buyer
  authorizes a ceiling and the facilitator settles the actual usage
- [Sign and pay](../buyers/sign-and-pay.md) for what happens between `fetch()` and
  the settlement hash
- [Pay for a resource](../buyers/pay-for-a-resource.md) to run an `exact` payment
  end to end on testnet
