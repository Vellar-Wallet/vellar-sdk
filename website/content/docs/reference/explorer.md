# The Explorer

> explorer.vellar.xyz is an independent Stellar indexer that classifies x402
> payments from raw ledger data without trusting any facilitator's
> self-reporting.

By the end of this page you will understand how the explorer decides that a
transaction is an x402 payment, how attribution to a named facilitator works,
what the live numbers do and do not claim, and how to query the index yourself.

## What it is

The explorer is a separate service in a separate open-source repository
(`Vellar-Wallet/vellar-explorer`, Apache-2.0). It is not part of the facilitator
and does not share a deployment with it.

It polls Soroban `getEvents` directly for SEP-41 transfer events on USDC, then
applies a structural heuristic to decide which of those transfers are x402
payments.

It does not ask the Vellar facilitator anything. Classification runs entirely
from ledger data. That is the point: a facilitator reporting its own volume is
an assertion, while a transaction shape read off the chain is evidence anyone
with an RPC endpoint can reproduce.

## How it classifies a payment

A transaction is counted as an x402 payment when all four of these hold:

1. It contains an `invoke_host_function` operation.
2. The operation is a `transfer(from, to, amount)` on the watched USDC SAC.
3. A detached address-credentialed auth entry authorizes `from`.
4. `from` is not the operation source, the transaction source, or the fee-bump
   fee source.

The fourth condition is the key test. It says that whoever authorized the
transfer is not whoever paid for the transaction, which is what fee sponsorship
looks like at the structural level, independent of the specific mechanism a
given facilitator uses to sponsor.

That independence matters for an indexer. It does not need to know how a
facilitator constructs its envelope, only that the payer of the ledger fee and
the authorizer of the token transfer are different parties.

## Two revisions to the classifier

Both revisions are worth understanding because they show what the heuristic
actually checks, and where a structural test can be wrong.

**v2, after a confirmed false negative on Vellar's own settlement.** v1 required
a CAP-15 fee-bump wrapper as the sponsorship signal. The Vellar facilitator
submits a plain transaction with the sponsor as `source_account` rather than a
fee-bump wrapper, so v1 missed every Vellar settlement. v2 fixed the detection
logic so sponsorship is inferred from the authorizer-versus-payer split rather
than from one particular envelope shape.

**v3, upto support.** For the `upto` scheme the settled amount is read from the
token contract's own emitted transfer event rather than from the envelope args.
`actual_amount` is set by the facilitator at settlement time and is not signed
by the buyer at authorization time, so reading the envelope args would report
the ceiling rather than the amount that actually moved.

## How attribution works

Attribution is a single hardcoded map from sponsor address to facilitator name.
It currently holds exactly one entry:
`GBUCR6H22CZC5OYHBJIEUS2JFZBOB63AHEGTCV6UEPMD2TMLKG2ZMIW4` maps to `vellar`.

There are two confidence values:

| Confidence | Meaning |
| --- | --- |
| `matched-known-signer` | `fee_account` matches a sponsor address in the registry |
| `unattributed` | No match in the registry |

The explorer does not probe `/supported` and has no self-registration endpoint.

Other facilitators are absent from the registry for a deliberate reason:
hardcoding a guessed key would make `matched-known-signer` a lie about what was
actually checked. A registry entry is a claim that a specific signer key was
confirmed, so an unconfirmed key belongs in `unattributed`, not in the map.

## What the live numbers mean

Live stats as of writing:

| Metric | Value |
| --- | --- |
| Total payments indexed | 7,988 |
| Attributed to Vellar | 386 |
| Unattributed | 7,602 |
| Registered facilitators | 1 |
| Vellar unique buyers | 302 |
| Vellar unique sellers | 4 |

> ⚠️ **386 of 7,988 is 4.8% of indexed payments, and it is not a market-share
> claim.** The registry knows exactly one signer key. The 7,602 unattributed
> payments are not competitors' measured share; they are transactions the
> explorer cannot identify because no other facilitator is registered.

The honest statement is this: the explorer has identified 386 x402 settlements
through Vellar out of 7,988 total x402-shaped payments on Stellar testnet since
August, across 302 unique buyers.

> **Note:** Both halves of that sentence are bounded. The 386 is bounded by the
> classifier and the one registered key. The 7,988 is bounded by the same
> structural heuristic, so it counts x402-shaped payments rather than payments
> confirmed to have gone through any facilitator.

## Querying the explorer

The API base URL is `https://vellar-explorer.onrender.com`.

```bash
BASE=https://vellar-explorer.onrender.com

# Recent classified payments
curl -sS "$BASE/payments?limit=5" | python3 -m json.tool

# Aggregate counts
curl -sS "$BASE/stats" | python3 -m json.tool

# The attribution registry, as it actually stands
curl -sS "$BASE/facilitators" | python3 -m json.tool

# Liveness
curl -sS "$BASE/health" | python3 -m json.tool
```

`/facilitators` is the one to read before quoting any attributed number: it
tells you how many signer keys the attribution map actually knows.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| A Vellar settlement does not appear in the feed | The classifier is structural, so a transaction that does not meet all four conditions is not indexed. v1 missed Vellar settlements entirely because it required a CAP-15 fee-bump wrapper | Check the transaction on Horizon against the four conditions, in particular that the authorizer is not the operation source, transaction source, or fee-bump fee source. v2 covers the plain-transaction shape Vellar submits |
| A payment shows as `unattributed` | Its `fee_account` is not in the hardcoded sponsor map, which currently holds one entry | Expected for any facilitator other than Vellar. There is no self-registration endpoint, so `unattributed` means unidentified, not non-Vellar-competitor |
| An `upto` settlement reports the ceiling rather than the actual amount | Reading `actual_amount` from the envelope args, which carry the buyer-signed ceiling rather than the facilitator-set settled amount | Fixed in v3, which reads the amount from the token contract's emitted transfer event |

## Next steps

- [Proofs](./proofs.md)
- [Conformance](./conformance.md)
- [The settlement path](../architecture/settlement-path.md)
- [The upto scheme](../concepts/upto-scheme.md)
