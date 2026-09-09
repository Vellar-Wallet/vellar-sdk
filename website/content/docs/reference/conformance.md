# Conformance

> Wire-level verification that Vellar settles real x402 payments using stock,
> unmodified upstream clients. Every claim on this page is checkable in a
> terminal against Horizon directly.

By the end of this page you will be able to verify independently that every
transaction hash listed here exists on Horizon, that the fee payer is the
facilitator's sponsor account rather than the buyer, and that the settlement
used genuine x402 wire format.

## Prerequisites

- `curl` and `python3` on your path (both used by every block below)
- Optional: `stellar` CLI and `shasum` for the contract hash check
- No wallet, no key, and no funded account: every command here is read-only

## What conformance means

Conformance here is tested at the wire level. A stock, unmodified `@x402/*`
client is pointed at the Vellar facilitator, and it settles. Nothing in the
client is patched, shimmed, or forked to make the payment go through.

That makes conformance a measurement, not a claim. The numbers below are what
a specific suite produced on a specific date, and the transaction hashes are
the evidence. If a hash does not resolve on Horizon, this page is wrong and you
should treat it as wrong.

## e2e suite results

The suite is the `x402-foundation/x402` end-to-end suite, run against the live
facilitator on 2026-09-08 at suite HEAD `241df66`.

**Result: 6 of 10 scenarios passed.**

The 4 failures were all "Server failed to start", on `typescript/http/next` and
`typescript/mcp`. The same failure reproduces against the upstream reference
facilitator used as a control, which confirms an upstream build problem rather
than a Vellar defect. Those scenarios never reached the payment path, so they
tested nothing about settlement in either direction.

> **Note:** 6 of 10 is the honest result. The 4 non-executing scenarios are not
> counted as passes, and a blocked or partial run is never presented as green.

## Six verified settlements from the e2e run

Each passing scenario produced a real on-chain settlement on Stellar testnet.

| # | Client + Server | Tx hash | Ledger |
|---|---|---|---|
| 1 | fetch + express | `b6712023355eaae20636da32a23909d0c74204ed0f6e46a6c6a10c06f4223ca4` | 4561546 |
| 2 | axios + express | `55c3026db406de06d3e24e93ec3a3c57f87ac10bd9bbbc10ab60cb78fc79132b` | 4561549 |
| 5 | fetch + hono | `ed32fe90f4bb2d882919601f5b8706da6cf8420a9f91ee3f765223a9a6c8c670` | 4561559 |
| 6 | axios + hono | `555d7538c0c81e590a2a32a1c9039bea412dcca23d72baae82711b38856fa733` | 4561562 |
| 7 | fetch + fastify | `22b97394a8bd99eeacf113cad9d13e390dd8b664cb163be9982e868ffed361c3` | 4561568 |
| 8 | axios + fastify | `b401ff7bc5c6c5774781588b4f16c2f4a4dff5ae235fa63c7129024d1eeb8a4a` | 4561571 |

All six were charged `fee_charged` 23059 stroops to the facilitator sponsor
account `GBUCR6H22CZC5OYHBJIEUS2JFZBOB63AHEGTCV6UEPMD2TMLKG2ZMIW4`, across
consecutive ledgers 4561546 to 4561571.

## Verify any settlement independently

Run this against Horizon. Nothing on this page is required to be trusted for it
to work.

```sh
curl -s "https://horizon-testnet.stellar.org/transactions/b6712023355eaae20636da32a23909d0c74204ed0f6e46a6c6a10c06f4223ca4" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("successful:", d["successful"]); print("ledger:", d["ledger"]); print("fee_account:", d["fee_account"]); print("fee_charged:", d["fee_charged"])'
```

Expected output:

```
successful: True
ledger: 4561546
fee_account: GBUCR6H22CZC5OYHBJIEUS2JFZBOB63AHEGTCV6UEPMD2TMLKG2ZMIW4
fee_charged: 23059
```

The `fee_account` line is the point of the whole exercise. It is the
facilitator's sponsor account, not the buyer, which is what
`areFeesSponsored: true` means in practice.

## Verify the live endpoints yourself

No wallet, key, or funded account is needed for any of this. The facilitator
runs on a free tier and sleeps after 15 minutes idle, so the first call takes
roughly 45 seconds (measured). Allow up to 120 seconds in your timeout rather
than assuming it is down.

```sh
BASE=https://vellar-facilitator.onrender.com

# 1. Liveness (rate-limit exempt, use it to warm the instance)
curl -s --max-time 120 "$BASE/health" | python3 -m json.tool

# 2. Advertised schemes, networks and extensions
curl -s "$BASE/supported" | python3 -m json.tool

# 3. Settle with an empty body: a rejection, on purpose
curl -s -X POST "$BASE/settle" \
  -H 'content-type: application/json' \
  -d '{}' | python3 -m json.tool
```

The third call is the interesting one. An empty body is not a valid payment, so
the facilitator rejects it rather than answering with a success. That is a live
service rejecting malformed input, not a static page returning 200 to anything.

`/supported` is where you confirm `areFeesSponsored: true` on both the `exact`
and `upto` kinds, and that the advertised network is `stellar:testnet`.

> ⚠️ **Rate limits apply.** 60 requests per minute per IP, and `/verify` and
> `/settle` bodies are capped at 32 KiB. `/health` is exempt from the rate
> limit, so use it for warming rather than hammering `/supported`.

## Verify the exact and upto settlements

The first settlement on the hosted instance used the `exact` scheme.

```sh
curl -s "https://horizon-testnet.stellar.org/transactions/1da6f9e6a90b78da898c99dfefba8821b5f632b72f584968fb057fd8a298e039" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("successful:", d["successful"]); print("ledger:", d["ledger"]); print("fee_account:", d["fee_account"]); print("fee_charged:", d["fee_charged"])'
```

Expected output:

```
successful: True
ledger: 3898493
fee_account: GBUCR6H22CZC5OYHBJIEUS2JFZBOB63AHEGTCV6UEPMD2TMLKG2ZMIW4
fee_charged: 28711
```

The experimental `upto` scheme settles on-chain the same way. Two `upto`
settlements are on record: `72c816a63ab9da21b1403ff5199e4f21b9947c0769c55312a8cf0dc7e6ecf3db`
(ledger 4250665) and the one below.

```sh
curl -s "https://horizon-testnet.stellar.org/transactions/be72877332bbd7f8d38511cccf00620fb20869cfedbc7530588ca856ac646d9a" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("successful:", d["successful"]); print("ledger:", d["ledger"])'
```

Expected output:

```
successful: True
ledger: 4252896
```

> **Note:** `upto` is EXPERIMENTAL. It is a Vellar-specific extension of x402
> v2 and is not yet in the finalized spec. `wallet.x402` does not build `upto`
> payments; it is exact-only. See [upto](../upto.md).

## Verify the upto contract

The `upto` contract Vellar deploys is
`CCZL7CTRS6GWEYXDYD54DZM3OUHQW2S2A4KSU75SH275P3SFZLL4YQAN`, deployed
2026-09-09. Fetch its wasm and hash it yourself.

```sh
stellar contract fetch \
  --network testnet \
  --id CCZL7CTRS6GWEYXDYD54DZM3OUHQW2S2A4KSU75SH275P3SFZLL4YQAN \
  --out-file upto.wasm

shasum -a 256 upto.wasm
```

Expected hash:

```
92365d9e5effe046a1db5b959bd2357672aef3f4b2137653c8095a0764d1f6c8
```

The source is `contracts/upto-vellar/` in the facilitator repo, Vellar's own
implementation (MIT) written from the x402 `upto` scheme specification, so the
hash is reproducible from that tree rather than only from the deployed
artifact. Build it with rustc 1.96.0 and stellar-cli 26.1.0, targeting
`wasm32v1-none`.

> **Note:** The hosted facilitator has not been redeployed against this contract
> yet, so `GET /supported` still advertises the earlier
> `CDHPA64M73TUTEM4MMHIWIXINBQXH7JJXFGZMGH22VJWFJFROMR6QV2S`. Read that field
> rather than assuming either value.

The facilitator repo also retains `contracts/upto-stellar/`, a vendored
Apache-2.0 copy of rail402's contract at commit
`ff504b85ac065369dc985759afe4164a4541d861`, kept for reference. Its wasm hashes
to `c276b905981eab91704ce9b9046ebb4867b164dd7e4ba0e0ecda841527d398a9`, which is
what the hosted facilitator serves today. The same source built by its upstream
author, testnet contract
`CCMM3FMGEH7FHRYXZ3WQDQCTIWDXGZBGW7D4UT7NKH34SUQACYC3U54X`, hashes to
`a19f563e764dfd52a0d229c063e7ac1a1b36f6a976f552a8e19b91ee8e4ef84a` instead,
because it was built with stellar CLI 27.0.0, the version stamped in its wasm
metadata, while ours was built with stellar CLI 26.1.0 and rustc 1.96.0; the CLI
writes its version into the wasm's `contractmetav0` section and the newer
toolchain emits different code, so the two artifacts cannot share a hash even
though their contract interface and protocol sections are byte-identical.

## Security finding F11 blocked on-chain

Finding F11 is an ownership hijack: a second seller settling a payment for a
resource URL they do not own, taking over that URL's catalog entry. It was
reproduced and then blocked in a controlled A/B test, with both halves settled
on-chain.

The test ran as two pairs on 2026-08-08, ninety seconds apart. In each pair,
settle #1 is a legitimate payment to merchant A, and settle #2 is the hijack
attempt from a different `payTo` against the same resource URL.

| Half | Role | Tx hash | Ledger |
|---|---|---|---|
| Pre-fix | settle #1, merchant A | `f7ea48f3070e9ad7e04bb61ffc95433ec4b0fac59befa74078ffad985603d0a2` | 4040686 |
| Pre-fix | settle #2, the hijack | `d56dc927a7c7c019197017b6a3dd92c198d9dce0d9d35749d8dbc896d0c4160d` | 4040689 |
| Post-fix | settle #1, merchant A | `c16af8224c474901b8fbf513b839926ddfb50707dc283a19f5f8629a24f028b3` | 4040704 |
| Post-fix | settle #2, the hijack | `a909e4748c83f55972d6cee3286b8627c304b231037c7daae51d869bf17f1d38` | 4040706 |

All four are `successful: true`, each charged `fee_charged` 23,067 stroops to the
sponsor account `GBOC2UOB7UI3LW2JDRSJQVCGI7SN7QD7AWELYCSNFY6GEWD4EPED6U3Y`, and
all four are stamped between 21:22 and 21:24 UTC on 2026-08-08.

**Pre-fix.** The second settlement overwrote merchant A's catalog entry and
inherited the accumulated trust stats along with it.

**Post-fix.** The identical attack was refused by the trust-on-first-use
ownership binding. The payment still settled and the attacker received their
funds from the buyer, but the catalog entry was unchanged.

Verify both halves. The pair is the point: without the pre-fix run showing the
hijack actually worked, "blocked" would be indistinguishable from a settlement
that broke for unrelated reasons.

```sh
# Pre-fix: the hijack succeeded, and the catalog entry was overwritten
curl -s "https://horizon-testnet.stellar.org/transactions/d56dc927a7c7c019197017b6a3dd92c198d9dce0d9d35749d8dbc896d0c4160d" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("successful:", d["successful"]); print("ledger:", d["ledger"]); print("fee_charged:", d["fee_charged"])'
# successful: True, ledger: 4040689, fee_charged: 23067

# Post-fix: the identical attack settled too, but the catalog was not updated
curl -s "https://horizon-testnet.stellar.org/transactions/a909e4748c83f55972d6cee3286b8627c304b231037c7daae51d869bf17f1d38" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("successful:", d["successful"]); print("ledger:", d["ledger"]); print("fee_charged:", d["fee_charged"])'
# successful: True, ledger: 4040706, fee_charged: 23067
```

> **Note:** `decisions.md` in the facilitator repo records this as 2026-08-09.
> All four transactions are timestamped 2026-08-08T21:22-21:23Z, a late-evening
> UTC run written up on the following local date. The UTC timestamps above are
> authoritative.

> ⚠️ **"Blocked" does not mean the payment failed.** Both payments succeeded
> on-chain. Blocked means the catalog protected the legitimate seller's entry
> and trust stats. The facilitator never refuses a valid payment to defend a
> listing, so do not expect a settlement failure as the signal here.

Ownership binding is trust-on-first-use: the first settled payment binds a
resource URL to its `payTo`. On the hosted free-tier instance the catalog has no
persistent disk, so bindings vanish on every restart or idle sleep and that
first-settler race reopens. See [Security](../security.md).

## Upstream contributions

Nothing has been merged. Two pull requests are open, both signed and verified.
Two issues are filed, one of which has attracted a community fix.

| Contribution | Status |
|---|---|
| `x402-foundation/x402` PR #3428, upto convergence spec, 349 lines | Open, signed, 0 reviews |
| `stellar/stellar-docs` PR #2836, community facilitators section | Open, ready for review |
| `x402-foundation/x402` issue #3125, settle discards RPC status | Fix in progress via PR #3293 by wakqasahmed |
| `x402-foundation/x402` issue #3158, canonical client cannot sign for smart accounts | Open |

## What is not yet done

- **No mainnet deployment exists.** There is no pubnet facilitator.
- The facilitator advertises `stellar:testnet` only, which you can confirm from
  the `/supported` call above.
- **No mainnet settled hash exists, and none is claimed.** Every hash on this
  page is Stellar testnet.
- The e2e suite is unrun on pubnet, for the same reason: there is nothing there
  to run it against.

## When it fails

| Symptom | Cause | Fix |
|---|---|---|
| Scenario fails with "Server failed to start" | Upstream build problem in the suite, not a Vellar defect; it reproduces against the upstream reference facilitator too | Nothing to fix on the Vellar side; the scenario never reaches the payment path |
| Hash not found on Horizon (404) | Querying the wrong network, e.g. pubnet Horizon | Use `horizon-testnet.stellar.org`; every hash here is testnet |
| `fee_account` is the buyer, not the sponsor | Fee sponsorship not in effect for that payment | Check `areFeesSponsored: true` on the kind in `GET /supported` |
| First curl to the facilitator hangs or times out | Free-tier cold start after 15 minutes idle | Retry with a 120s timeout; first call takes roughly 45s (measured) |

## Next steps

- [The payment loop](../concepts/payment-loop.md), what the wire format
  actually looks like end to end
- [The exact scheme](../concepts/exact-scheme.md), the scheme every hash above
  except the two `upto` ones used
- [Security](../security.md), the model F11 was found and fixed under
- [Facilitator](../facilitator.md), the endpoints, limits, and operational
  caveats in full
