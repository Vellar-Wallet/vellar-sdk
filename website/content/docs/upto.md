# `upto` — Metered Payments

A second payment scheme alongside `exact`: the buyer authorizes a **spending
ceiling** with one signature, and the facilitator settles for the **actual
metered amount** — usage-based pricing without a signature per unit consumed.

> **Status: experimental.** This is a Vellar-specific extension of x402 v2,
> not yet part of the finalized spec. The wire shape may change before
> upstream settles on one — see [x402-foundation/x402 #3134](https://github.com/x402-foundation/x402/pull/3134),
> which proposes standardizing an `upto` scheme for Stellar and is open,
> alongside a competing proposal. Don't build against this expecting the wire
> format to be stable yet.

## Why this exists

`exact` needs the price known and signed before the resource is served — fine
for a flat-rate API call, wrong for anything metered: tokens generated,
seconds of compute, rows returned. `upto` lets a seller charge for what was
actually used, capped by what the buyer agreed to risk.

## How it's enforced

The buyer signs one authorization: `(token, from, to, max_amount, expiration,
nonce)` — notably **not** the actual amount. At settlement, the facilitator
supplies the metered `actual_amount`, and a Soroban contract checks
`actual <= max` **on-ledger** before it moves anything. The facilitator
cannot settle more than the ceiling the buyer signed, because the chain
refuses the transaction if it tries — this isn't a promise the facilitator
makes, it's a bound the contract enforces regardless of what the facilitator
does.

## Using it

`GET /supported` now advertises both schemes for `stellar:testnet`:

```json
{
  "kinds": [
    { "scheme": "exact", "network": "stellar:testnet", "extra": { "areFeesSponsored": true } },
    {
      "scheme": "upto",
      "network": "stellar:testnet",
      "extra": {
        "uptoContract": "CDHPA64M73TUTEM4MMHIWIXINBQXH7JJXFGZMGH22VJWFJFROMR6QV2S",
        "areFeesSponsored": true
      }
    }
  ]
}
```

`/verify` and `/settle` accept `scheme: "upto"` payloads the same way they
accept `exact` ones. Two things worth knowing if you're integrating by hand:
the settlement hook is refused (no arbitrary post-settle callback), and
`/verify` simulates at the ceiling, not the actual, since the actual isn't
decided yet.

### The wire shape

`payload.payload.transaction` is a **base64-encoded, unsigned Soroban
transaction envelope** that invokes the deployed contract's `settle`
function — "unsigned" at the envelope level; what actually carries the
buyer's authorization is the Soroban auth entries attached to that one
operation, which **are** signed. The facilitator never relays this envelope
as-is: it rebuilds the transaction from its own sponsor account (so the
buyer holds no XLM and pays no fee) and swaps in the metered `actual_amount`
before submitting.

This is the actual request body `POST /verify` and `POST /settle` both take
— matching what `examples/upto-buyer.mjs` constructs. `paymentPayload.accepted`
is the same object as the top-level `paymentRequirements` (omitted a second
time below for brevity):

```json
{
  "x402Version": 2,
  "paymentPayload": {
    "x402Version": 2,
    "accepted": { "...": "same object as paymentRequirements below" },
    "payload": { "transaction": "AAAAAgAAAAC1I3O2CN...(base64, unsigned envelope)" }
  },
  "paymentRequirements": {
    "scheme": "upto",
    "network": "stellar:testnet",
    "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    "amount": "1000000",
    "payTo": "GDEST...",
    "maxTimeoutSeconds": 120,
    "extra": { "actualAmount": "400000" }
  }
}
```

**The metered actual lives in `requirements.extra.actualAmount`** (a string,
atomic units) — set by the seller/facilitator at settlement time, not
something the buyer ever signs. It's the one field that's easy to miss: the
buyer's signed authorization deliberately excludes it (that's the whole
point — the signature covers the ceiling, not the eventual charge), and if
you omit it entirely the facilitator settles for the full ceiling rather
than a metered amount.

**The settle response's `amount` is the actual settled amount, not the
ceiling** — distinct from `paymentRequirements.amount`, which stays the
ceiling throughout:

| Field | Meaning | Example above |
| --- | --- | --- |
| `paymentRequirements.amount` | The **ceiling** the buyer authorized (`max_amount`) | `"1000000"` |
| `SettleResponse.amount` | The **actual** amount settled (`actual_amount`, ≤ ceiling, enforced on-ledger) | `"400000"` |

A settle response looks like `{ "success": true, "transaction": "<hash>",
"payer": "G...", "amount": "400000" }` — reconcile against
`paymentRequirements.amount`, not the other way around, if you need to
confirm how much of the ceiling was actually used.

### Contract argument order

For anyone building the invocation by hand, the deployed contract's `settle`
takes exactly eight arguments, in this order — get this wrong and it fails
before any signature is even checked:

```
(token, from, to, max_amount, expiration_ledger, nonce, actual_amount, hook)
```

**`hook` must be `None`/void.** The facilitator refuses anything else
(`invalid_upto_stellar_hook_not_supported`) — it's a deliberate settlement
hook, not a defended one, because nothing legitimate needs it and refusing
is cheaper than sandboxing an arbitrary post-settle callback aimed at the
sponsor.

**Not yet in `vellar-sdk`.** `wallet.x402.fetch()` speaks `exact` only right
now. To pay with `upto` today, build the authorization by hand — the same way
[the smart-account buyer example](./x402.md) does for `exact`, because the
official x402 client doesn't support this scheme either.

**End-to-end client:** `examples/upto-buyer.mjs` in the facilitator repo signs
the ceiling authorization and drives `/verify` + `/settle` directly.

```sh
cd examples
FACILITATOR_URL=http://localhost:4100 UPTO_CONTRACT=C... \
PAYER_SECRET=S... PAYTO=G... ASSET=C... SIM_SOURCE_ACCOUNT=G... \
MAX=1000000 ACTUAL=400000 node upto-buyer.mjs
```

`SIM_SOURCE_ACCOUNT` must be a funded account that **is not** the payer —
same reason as the `exact` smart-account flow: simulating from the payer
yields source-account credentials the scheme rejects.

## Deployed contract

Published so it can be verified against its source without trusting this
page — every value below is independently checkable.

| | |
| --- | --- |
| Contract ID (testnet) | `CDHPA64M73TUTEM4MMHIWIXINBQXH7JJXFGZMGH22VJWFJFROMR6QV2S` |
| Wasm hash (on-chain) | `c276b905981eab91704ce9b9046ebb4867b164dd7e4ba0e0ecda841527d398a9` |
| Source | `contracts/upto-stellar/` in the [facilitator repo](https://github.com/Vellar-Wallet/vellar-facilitator) — vendored verbatim (Apache-2.0) from [rail402](https://github.com/tolgayayci/rail402)'s `contracts/upto-stellar/` at commit `ff504b85ac065369dc985759afe4164a4541d861`, reviewed line-by-line before vendoring |
| Deployed | 2026-08-21, from the facilitator repo's own sponsor account |

The on-chain wasm hash is the sha256 of the wasm, so anyone can rebuild and
compare:

```sh
cd contracts/upto-stellar
stellar contract build
shasum -a 256 target/wasm32v1-none/release/x402_upto_stellar.wasm
# → c276b905981eab91704ce9b9046ebb4867b164dd7e4ba0e0ecda841527d398a9
```

Full deployment record, including the fetch-and-compare steps against the
live contract and the first on-chain settlement's transaction hash:
[`docs/upto-deployment.md`](https://github.com/Vellar-Wallet/vellar-facilitator/blob/main/docs/upto-deployment.md)
in the facilitator repo.

## Watch it settle

[explorer.vellar.xyz](https://explorer.vellar.xyz) is a public transaction
explorer for this facilitator's settlements, `upto` included — the actual
metered amount on a real settlement is easier to see there than to reconstruct
from a signed ceiling.
