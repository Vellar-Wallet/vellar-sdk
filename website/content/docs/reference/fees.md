# Fees and Sponsorship

> Every Vellar settlement charges the network fee to the facilitator's sponsor
> account, not the buyer. The buyer needs only the payment asset. This page
> explains what fees actually are, what they cost by payment type, and what
> happens when the ceiling is too low.

By the end of this page you will understand the difference between the fee bid,
the fee charged, and the spend accounting estimate, know the real measured cost
of each payment type in stroops, understand why policy-governed payments need a
higher ceiling than the default, and know how the sponsor balance guards work.

## The three numbers called "fee"

This is the most important thing on this page. Three different quantities all
get called "the fee", and confusing them causes real debugging pain.

| Name | What it is | Where it appears |
| --- | --- | --- |
| `fee_charged` | What the sponsor actually paid. The number on the receipt. | `fee_charged` in any Horizon transaction response |
| bid (`minResourceFee` + `BASE_FEE`) | What the facilitator offers before submission. Compared against `MAX_TX_FEE_STROOPS`. If the bid exceeds the ceiling, settlement is refused before submission and nothing is spent. | Never visible externally |
| spend estimate | 500,000 stroops. A conservative constant used for budget accounting. Not a measurement, and not the ceiling. | Internal accounting only |

> ⚠️ **The ceiling is compared against the bid, not the charge.** A payment that
> bids 130,000 stroops is refused by a facilitator with a 100,000 stroop
> ceiling, even though the actual charge would have been only 86,000 stroops.
> The refusal happens before submission and costs nothing.

## Real measured fee_charged values

These are confirmed on Horizon. They are what the sponsor actually paid, not
estimates.

| Payment type | fee_charged | XLM equivalent |
| --- | --- | --- |
| exact, classic keypair | 23,059 to 28,711 stroops | about 0.0023 to 0.0029 XLM |
| exact, policy-governed smart account | 85,999 stroops | about 0.0086 XLM |
| upto, smart account | 39,949 stroops | about 0.0040 XLM |

Verify any of these yourself:

```bash
# exact, keypair settlement
curl -s \
  "https://horizon-testnet.stellar.org/transactions/1da6f9e6a90b78da898c99dfefba8821b5f632b72f584968fb057fd8a298e039" \
  | python3 -c \
  "import json,sys; \
  d=json.load(sys.stdin); \
  print('fee_charged:', d['fee_charged']); \
  print('fee_account:', d['fee_account'])"
# fee_charged: 28711
# fee_account: GBUCR6H2... (the facilitator sponsor, not the buyer)

# exact, policy-governed smart account
curl -s \
  "https://horizon-testnet.stellar.org/transactions/a48818609704818b6e81c6c67c2e89bbace37d49b17819bf684eb6ad1da1d5a0" \
  | python3 -c \
  "import json,sys; \
  d=json.load(sys.stdin); \
  print('fee_charged:', d['fee_charged'])"
# fee_charged: 85999
```

The `fee_account` is the facilitator's sponsor, not the buyer. That is
`areFeesSponsored: true` demonstrated on-chain rather than asserted.

## Why policy-governed payments cost more

A policy-governed payment runs the spending-limit policy contract inside
`__check_auth` during settlement, which adds Soroban compute cost on top of the
base transfer.

Roughly:

- Base transfer (keypair): 23,000 to 29,000 stroops
- Policy execution overhead: 57,000 to 63,000 stroops
- Total (policy-governed): about 86,000 stroops

That is roughly 3x a plain keypair settle, not the 7x to 9x that simulation
estimates sometimes suggest. Simulation overbids to make sure the transaction is
accepted; the actual charge comes in lower.

> **Note:** The Vellar facilitator's default ceiling of 500,000 stroops is
> enough headroom for every measured settlement type. The reference `x402.org`
> facilitator defaults to 50,000 stroops, which is below the bid for any
> policy-governed payment. Such a payment sent to the reference facilitator is
> refused with `fee_exceeds_maximum` even though the payment is valid and the
> policy approved it. This is why the Vellar facilitator exists for agent
> payments.

## The fee ceiling

`MAX_TX_FEE_STROOPS` (default 500,000) is compared against the bid before
submission. If the bid exceeds it, the facilitator refuses the settlement
without submitting.

The buyer is not charged on a ceiling refusal. Nothing is spent, and the error
is `fee_exceeds_maximum`.

If you run your own facilitator and serve smart-account buyers, set
`MAX_TX_FEE_STROOPS` to at least 200,000 to accommodate policy-governed
payments. 500,000 gives comfortable headroom.

```bash
# In your .env or environment:
MAX_TX_FEE_STROOPS=500000
```

## The sponsor balance guards

The facilitator monitors its sponsor account balance and refuses `/settle`
before going on-chain when the balance is too low.

| Level | Threshold | Action |
| --- | --- | --- |
| Soft floor | 25 XLM (250,000,000 stroops) | Alerts, and settlement continues |
| Hard floor | 10 XLM (100,000,000 stroops) | Refuses `/settle` with `settlement_refused: sponsor_balance_low` |

The hard-floor refusal happens before submission, so nothing is spent. The
buyer should retry once the operator has refunded the sponsor.

This protects against availability failures from an underfunded sponsor.
Without it the facilitator would submit transactions that then fail on-chain
with confusing errors.

> ⚠️ **You cannot test this on testnet.** Spend-control refusals, including
> `sponsor_balance_low`, are logged there but not enforced, so the settlement
> proceeds. They are enforced on pubnet.

## Verifying fee sponsorship

On any settlement, `fee_account` in the Horizon response should be the
facilitator's sponsor rather than the buyer's address. That is how to confirm
`areFeesSponsored: true` is actually funded at runtime:

```bash
curl -s \
  "https://horizon-testnet.stellar.org/transactions/<any-settlement-hash>" \
  | python3 -c \
  "import json,sys; \
  d=json.load(sys.stdin); \
  print('fee_account:', d['fee_account']); \
  print('successful:', d['successful'])"
```

If `fee_account` is the buyer's address, fee sponsorship is not working. Check
that your facilitator's sponsor account is funded.

## If you run your own facilitator

| Variable | Default | What it controls |
| --- | --- | --- |
| `MAX_TX_FEE_STROOPS` | 500,000 | Fee bid ceiling. Raise it if you serve smart-account buyers. |
| `SPONSOR_SOFT_FLOOR_STROOPS` | 250,000,000 | Alert threshold (25 XLM) |
| `SPONSOR_HARD_FLOOR_STROOPS` | 100,000,000 | Hard refusal threshold (10 XLM) |
| `SPEND_CEILING_STROOPS` | 50,000,000 | Global spend ceiling (5 XLM per window) |
| `SPEND_WINDOW_MS` | 60,000 | Spend window length in milliseconds |

The spend ceiling and window are enforced on pubnet only. On testnet they are
logged as would-reject and the settlement proceeds.

## What the fee actually pays for

The Stellar network fee is charged to the facilitator's sponsor account, not the
buyer, so the buyer needs only the payment asset such as USDC. The fee covers
the ledger operation, and for a policy-governed payment that includes running
`__check_auth`, which runs the spending-limit policy contract.

## When it fails

| Error | Cause | Fix |
| --- | --- | --- |
| `fee_exceeds_maximum` | The payment's bid exceeded `MAX_TX_FEE_STROOPS` | Raise `MAX_TX_FEE_STROOPS`, or use the Vellar facilitator with its 500,000 default |
| `settlement_refused: sponsor_balance_low` | Sponsor balance is below the hard floor | Fund the sponsor account with more XLM |
| Settlement succeeds but the buyer was charged XLM | Fee sponsorship is not working | Check that the facilitator has a funded sponsor and advertises `areFeesSponsored: true` in `/supported` |

## Next steps

- [The payment loop](../concepts/payment-loop.md)
- [The exact scheme](../concepts/exact-scheme.md)
- [Conformance](./conformance.md)
- [Facilitator and Bazaar](../facilitator.md)
