# Stellar Essentials

> The five Stellar concepts every other Vellar page assumes: trustlines, SEP-41 amounts, fee sponsorship, Soroban authorization entries, and smart accounts.

By the end of this page you will understand why sellers need trustlines, how to do
amount arithmetic without floating-point bugs, why the buyer needs no XLM, and the
difference between a `G...` account and a `C...` account.

## Prerequisites

- Basic familiarity with the x402 payment flow (see
  [How it works](../getting-started/how-it-works.md))
- `@stellar/stellar-sdk` available if you want to run the trustline snippet
- A testnet account, funded by Friendbot, for anything you actually submit

## Trustlines

A Stellar account cannot hold a SEP-41 asset until it has a trustline to that
asset. This is not an optional optimization: without the trustline the asset
simply cannot land in the account.

Buyers usually notice this immediately, because they cannot acquire the token in
the first place. The one people forget is the seller's. The `payTo` address in a
payment challenge must trust the asset before it can receive it.

> ⚠️ **A missing trustline on the seller's `payTo` fails late and confusingly.**
> The payment verifies successfully, then fails at settlement with an on-chain
> error that reads exactly like a spend control refusing it. Check trustlines at
> boot, before you accept payments, rather than debugging it one settlement at a
> time.

Adding a trustline for testnet USDC (Circle's official testnet issuer):

```js
import {
  Asset,
  Horizon,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const USDC = new Asset(
  "USDC",
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
);

const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");
const account = await horizon.loadAccount(sellerKeypair.publicKey());

const tx = new TransactionBuilder(account, {
  fee: "1000",
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(Operation.changeTrust({ asset: USDC }))
  .setTimeout(60)
  .build();

tx.sign(sellerKeypair);
await horizon.submitTransaction(tx);
```

> **Note:** The Stellar Asset Contract (SAC) for that issuer on testnet is
> `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`. That contract id is
> what appears in payment requirements as the asset; the `G...` issuer above is
> what a classic trustline points at.

## SEP-41 amounts and stroop math

SEP-41 assets on Stellar use 7 decimal places, so one whole unit is
`10_000_000` atomic units. Every amount that crosses the x402 boundary is an
integer in those atomic units, never a decimal string.

> ⚠️ **Never use floating-point math on a payment amount.** JavaScript's `Number`
> silently loses precision on large integers, so a rounding error becomes a real
> overpayment or a rejected payment. Use `BigInt` for every amount, end to end.

| BigInt | Whole units |
|---|---|
| `1_000_000n` | 0.1 |
| `5_000_000n` | 0.5 |
| `10_000_000n` | 1.0 |
| `100_000_000n` | 10.0 |

Converting a human decimal to atomic units means multiplying by `10_000_000` and
keeping the result a `BigInt`:

```js
// 0.25 USDC, expressed without ever touching a float on the result
const atomic = 25n * 100_000n; // 2_500_000n

// Displaying it back: integer division for the whole part, remainder for the rest
const whole = atomic / 10_000_000n; // 0n
const frac = (atomic % 10_000_000n).toString().padStart(7, "0"); // "2500000"
```

Do not divide a float and then round. Build the integer first, and only convert
to a display string at the very edge, where precision no longer matters.

## Fee sponsorship

Stellar charges a network fee for every transaction, paid by the transaction's
source account. In the x402 flow the facilitator sets its own account as the
source and pays that fee, so the buyer needs only the payment asset. A buyer's
account can hold zero XLM and still pay.

An option advertises this as `areFeesSponsored: true` in its `extra` object in
`/supported`. Both Vellar schemes advertise it, the SDK reads it during option
selection, and it throws `NoUsablePaymentOptionError` if no option advertises it.

Advertising is a claim. The check that it is actually funded at runtime is the
fee account on a settled transaction:

```bash
# The facilitator sponsor account is
# GBUCR6H22CZC5OYHBJIEUS2JFZBOB63AHEGTCV6UEPMD2TMLKG2ZMIW4,
# note this is the facilitator, not the buyer.
curl -s "https://horizon-testnet.stellar.org/transactions/1da6f9e6a90b78da898c99dfefba8821b5f632b72f584968fb057fd8a298e039" \
  | jq '{fee_account, successful}'

# {
#   "fee_account": "GBUCR6H22CZC5OYHBJIEUS2JFZBOB63AHEGTCV6UEPMD2TMLKG2ZMIW4",
#   "successful": true
# }
```

That transaction settled at ledger 3898493 with `fee_charged` 28711 stroops,
charged to the sponsor and not to the buyer.

## Soroban authorization entries

The buyer does not sign a full Stellar transaction. The buyer signs a Soroban
authorization entry, which authorizes one specific contract call:
`transfer(from = buyer, to = seller, amount)` on the asset's Stellar Asset
Contract.

The facilitator builds the whole transaction around that signed entry, sets
itself as the source, pays the fee, and submits. That separation is what makes
fee sponsorship possible: the thing the buyer signs says nothing about who pays
the network fee.

An authorization entry is valid only up to its expiration ledger. Expiration is
counted in ledgers, not wall-clock time. Once the entry expires the signature is
dead, verify and settle both fail, and no retry of the same payload can succeed.
Sign a fresh payload instead of caching one.

> **Note:** The [`upto`](../concepts/upto-scheme.md) contract enforces its own
> separate ceiling on top of this: `expiration_ledger` must not exceed
> `current_ledger + 17,280`, about 24 hours at 5 seconds per ledger.

## G accounts vs C accounts

| | `G...` account | `C...` account |
|---|---|---|
| Address starts with | `G` | `C` |
| Controlled by | ed25519 keypair | `__check_auth` contract |
| Can hold on-chain spending policies | No | Yes |
| Vellar wallet type | No, classic buyer | Yes, smart wallet |

The Vellar passkey wallet creates `C...` accounts: Soroban smart-contract
accounts whose authorization runs through `__check_auth`, which is where a
spending-limit [policy](../agent-tooling/policies.md) lives. Classic buyers use `G...`
accounts, plain ed25519 keypairs that cannot hold policies at all. The
facilitator settles from both.

Smart-account payments cost more in fees, because settlement actually runs
`__check_auth` and any policy attached to the account. See
[Fees and Sponsorship](../reference/fees.md) for measured figures. That extra
cost is why Vellar ships a 500,000 stroop ceiling (raisable via
`MAX_TX_FEE_STROOPS`). The reference x402.org facilitator defaults to 50,000
stroops and rejects those payments with `fee_exceeds_maximum`.

## When it fails

| Symptom | Cause | Fix |
|---|---|---|
| Settlement fails with an on-chain error that looks like a policy rejection | The seller's `payTo` has no trustline to the payment asset | Add the trustline to `payTo` and check trustlines at boot before accepting payments |
| Amount arithmetic off by a factor of 10 | Decimal and `BigInt` math mixed in the same calculation | Keep every amount a `BigInt` in atomic units; multiply by `10_000_000`, never divide then round |
| Smart-account payment rejected with `fee_exceeds_maximum` | The facilitator's fee ceiling is too low for a payment that runs `__check_auth` | Use a facilitator with a raised ceiling (Vellar ships 500,000 stroops, raisable via `MAX_TX_FEE_STROOPS`) |
| Signature rejected after waiting | The authorization entry expired; expiration is ledger-based, not wall-clock | Sign a fresh payload per attempt and do not cache signed payloads |

## Next steps

- [The payment loop](./payment-loop.md), the full request, challenge, sign,
  settle cycle these primitives serve
- [The exact scheme](./exact-scheme.md), how a fixed-price payment is built and
  settled
- [Pay for a resource](../buyers/pay-for-a-resource.md), the runnable buyer path
- [x402 Facilitator](../facilitator.md), the hosted instance, its endpoints, and
  its fee ceiling
