# The Upto Scheme

> Metered settlement on Stellar. The buyer authorizes a spending ceiling and only the actual usage settles, enforced on-ledger by a Soroban contract.

By the end of this page you will understand why `upto` needs a deployed Soroban contract when `exact` does not, what the two guarantees the contract enforces on-ledger actually are, how the contract composes with a smart account's spending-limit policy, and what is still broken in the current deployment.

## Prerequisites

- You have read [the payment loop](./payment-loop.md) and [the exact scheme](./exact-scheme.md), since `upto` is a variation on the same verify/settle flow.
- You have the Stellar CLI installed if you want to run the contract verification step.
- You know that `upto` is EXPERIMENTAL: a Vellar-specific extension of x402 v2, not yet part of the finalized spec.

## Exact vs upto

| | `exact` | `upto` |
| --- | --- | --- |
| Buyer signs | One specific amount | A ceiling |
| What settles | Exactly that amount | Actual usage, up to the ceiling |
| Enforced by | SEP-41 `transfer` | Soroban contract |
| Fits | Fixed-price calls | Metered billing |

The `exact` scheme needs the price known and signed before the resource is served. That is correct for a flat-rate API call and wrong for anything metered: tokens generated, seconds of compute, rows returned. `upto` lets the seller charge for what was actually used, capped by what the buyer agreed to risk.

## Why a Soroban contract is required

The obvious cheaper design is a plain SEP-41 allowance: the buyer calls `approve` for the ceiling, and the facilitator later draws the metered amount with `transfer_from`. That does not give you the guarantees this scheme needs.

An allowance is a standing permission, not a single authorization. Once granted, the spender can draw *any* amount up to the ceiling, *multiple times*, until the allowance is exhausted or expires, and it can send those funds to *any* recipient it chooses. A buyer who meant to authorize one metered call for at most 1.0 USDC has instead handed out a reusable 1.0 USDC budget. Nothing in the token contract ties the draw to a single settlement, to a single recipient, or to a single use.

The `upto` contract closes that gap. It sits between the buyer's authorization and the SAC transfer, and it enforces two things on-ledger:

1. **The settled amount never exceeds the authorized ceiling.** The contract checks `actual_amount <= max_amount` before it moves anything. This is not a promise the facilitator makes, it is a bound the chain enforces regardless of what the facilitator does or intends.
2. **A single authorization settles exactly once and cannot be replayed.** The authorization carries a nonce that the contract consumes on settlement. A second submission of the same signed tuple is refused by the ledger, not by the facilitator's bookkeeping.

The deployed testnet contract is:

```
CDHPA64M73TUTEM4MMHIWIXINBQXH7JJXFGZMGH22VJWFJFROMR6QV2S
```

The facilitator advertises it in `GET /supported`, under the `upto` kind's `extra.uptoContract`:

```json
{
  "scheme": "upto",
  "network": "stellar:testnet",
  "extra": {
    "uptoContract": "CDHPA64M73TUTEM4MMHIWIXINBQXH7JJXFGZMGH22VJWFJFROMR6QV2S",
    "areFeesSponsored": true
  }
}
```

Read that field before you sign. It tells you exactly which contract you are about to authorize, so you are not trusting the facilitator's word about which code will hold your ceiling.

> **Note:** If you are running your own facilitator, set `UPTO_CONTRACT_ID` to the contract address in your environment. Without it the `upto` scheme is not registered and not served, and only the `exact` scheme runs. The hosted instance at `vellar-facilitator.onrender.com` has this set already. See [Configuration](../operators/configuration.md).

## Verify the contract reproducibly

Fetch the deployed wasm off the ledger and hash it yourself:

```sh
stellar contract fetch \
  --id CDHPA64M73TUTEM4MMHIWIXINBQXH7JJXFGZMGH22VJWFJFROMR6QV2S \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  --out-file fetched.wasm

shasum -a 256 fetched.wasm
# → c276b905981eab91704ce9b9046ebb4867b164dd7e4ba0e0ecda841527d398a9
```

That hash is what builds reproducibly from the vendored source at `contracts/upto-stellar/` in the facilitator repo. The source is vendored verbatim (Apache-2.0) from rail402's `contracts/upto-stellar/` at commit `ff504b85ac065369dc985759afe4164a4541d861`, and the instance was deployed on 2026-08-21. Credit for the contract belongs to rail402; Vellar deployed it, it did not write it.

If the two hashes match, the code holding your ceiling is the code you can read.

## The authorization tree

A Soroban authorization is a tree, and for `upto` it has two nodes.

The root node is the buyer authorizing the `upto` contract to run `settle`. The child node is the `upto` contract invoking `transfer` on the USDC Stellar Asset Contract, moving funds from the buyer to the seller.

The buyer's signature covers the root: `(token, from, to, max_amount, expiration_ledger, nonce)`. It deliberately does **not** cover the actual amount, because at signing time the resource has not been served and nothing has been metered yet. The actual is supplied at settlement, and the contract's job is to prove it fits inside what was signed.

That is the whole reason `actualAmount` is not part of the signed tuple. It lives in `requirements.extra.actualAmount` (a string, in atomic units), set at settle time. Omit it and the facilitator settles the **full ceiling**, which is a silent overcharge rather than an error. `SettleResponse.amount` is the actual settled amount; `paymentRequirements.amount` stays the ceiling throughout.

The contract's `settle` takes eight arguments in this order:

```
(token, from, to, max_amount, expiration_ledger, nonce, actual_amount, hook)
```

Get the order wrong and it fails before any signature is checked.

> ⚠️ **`hook` must be `None`/void.** The facilitator refuses anything else with `invalid_upto_stellar_hook_not_supported`. It is a deliberately refused settlement hook, not a defended one: nothing legitimate needs an arbitrary post-settle callback aimed at the sponsor, and refusing is cheaper than sandboxing one.

One more bound worth knowing before you sign: `expiration_ledger` must not exceed `current_ledger + 17,280`, roughly 24 hours at 5 seconds per ledger. A ceiling authorization cannot be left open indefinitely.

## Composing with spending policies

A Vellar wallet is a C address, a Soroban smart account governed by `__check_auth`, so it can carry a spending-limit policy. That policy caps cumulative spend over a fixed window. The obvious question is what a *ceiling* does to a budget when the eventual charge is smaller.

The answer is reserve-then-reconcile:

1. When the buyer signs the `upto` authorization, the policy's `enforce()` reserves the **full ceiling** against the budget. The worst case is booked immediately.
2. After settlement, the contract calls `release()` with the **actual** amount.
3. The budget ends at the actual charge, not the ceiling.

So an agent's budget is debited correctly on metered calls. Between signing and settlement the agent's remaining budget looks pessimistic, which is the safe direction: the agent cannot commit to two ceilings it could not both cover. Once the meter is read, the difference comes back.

> **Note:** the spending-limit policy caps cumulative spend over a FIXED (tumbling) window. `spent` resets to zero when the window elapses, it does not slide. Spending timed around a window boundary can move up to 2x the cap in a short span. Treat it as a guardrail, not a to-the-stroop hard cap. See [policies](../agent-tooling/policies.md).

## Known limitation

> ⚠️ **Upto settlement is not wired into the channel-account pool.** Concurrent `upto` settlements share the sponsor's sequence number, so they can fail with `txBadSeq`. Serialize `upto` settlements until this is fixed. `upto` is marked EXPERIMENTAL and should not be described as production-ready.

> **Note:** `wallet.x402` does not build `upto` payments. The current SDK flow is exact-only, so `upto` is reached by talking to the facilitator directly, building the authorization by hand. See [the upto reference](../upto.md) for the wire shape and a working buyer script.

## Settled transaction hashes

Two `upto` settlements on Stellar testnet, both verifiable against Horizon without trusting this page:

```sh
curl -s "https://horizon-testnet.stellar.org/transactions/72c816a63ab9da21b1403ff5199e4f21b9947c0769c55312a8cf0dc7e6ecf3db" \
  | jq '{successful, ledger}'
# → { "successful": true, "ledger": 4250665 }
```

```sh
curl -s "https://horizon-testnet.stellar.org/transactions/be72877332bbd7f8d38511cccf00620fb20869cfedbc7530588ca856ac646d9a" \
  | jq '{successful, ledger}'
# → { "successful": true, "ledger": 4252896 }
```

Both are testnet. There is no mainnet deployment: the facilitator advertises `stellar:testnet` only, no mainnet settled hash exists, and none is claimed.

You can also watch settlements classified off the ledger at [explorer.vellar.xyz](https://explorer.vellar.xyz).

## When it fails

| Error | Cause | Fix |
| --- | --- | --- |
| `txBadSeq` on concurrent `upto` settlements | Upto settlement is not wired into the channel-account pool, so concurrent settlements share the sponsor's sequence number | Serialize `upto` settlements |
| Ceiling exceeded at settle | The contract enforces `actual_amount <= max_amount` on-ledger | The buyer must authorize a higher ceiling and sign again |
| Authorization replayed | The single-use nonce was already consumed by the first settlement | Sign a fresh payload |
| Expiration ledger past | Same as the exact scheme: signatures expire in ledgers, not wall-clock, and the ceiling is capped at `current_ledger + 17,280` | Sign fresh, do not reuse a cached payload |
| `invalid_upto_stellar_hook_not_supported` | `hook` was not `None`/void; the facilitator refuses any hook | Pass `None` |

## Next steps

- [The payment loop](./payment-loop.md) for the verify/settle flow both schemes share
- [The exact scheme](./exact-scheme.md) for the fixed-price counterpart
- [Upto reference](../upto.md) for the wire shape, seller registration, and a runnable buyer
- [Policies](../agent-tooling/policies.md) for how the spending-limit budget is enforced by consensus
