# Proofs

> Every verifiable claim on this site, indexed on one page with copy-paste curl
> commands. Nothing here requires trusting us: every hash resolves
> independently on Horizon.

By the end of this page you will have independently verified that Vellar settles
real payments on Stellar testnet, that fees are paid by the facilitator and not
the buyer, that the `upto` contract is reproducible from published source, and
that the F11 security fix works exactly as claimed.

## Prerequisites

- `curl` and `python3` on your path
- Optional: the `stellar` CLI and `shasum`, for the contract hash check
- No wallet, no key, no funded account: every command here is read-only

## How to verify

Every command below reads from Horizon directly. None of them contact the
Vellar facilitator, except the live-state section, which is explicitly about the
facilitator being up. A result that does not match what is documented here is a
discrepancy worth reporting.

## Live facilitator state

Before verifying individual hashes, confirm the facilitator is live.

```bash
BASE=https://vellar-facilitator.onrender.com

# Liveness and current state
curl -sS --max-time 120 "$BASE/health" | python3 -m json.tool

# What schemes are advertised
curl -sS "$BASE/supported" | python3 -m json.tool

# A rejection carries a non-null reason
curl -sS -X POST "$BASE/settle" \
  -H "Content-Type: application/json" \
  -d "{}" | python3 -m json.tool
```

Expect `status: ok`, `stellar:testnet` with `areFeesSponsored: true` on both the
`exact` and `upto` kinds, and a non-null `errorReason` on the empty settle.

> **Note:** The instance sleeps after 15 minutes idle, so the first call takes
> roughly 45 seconds (measured). Allow up to 120 seconds in your timeout.
> `/health` is exempt from the rate limit, so warm with that rather than
> hammering `/supported`.

## Exact scheme settlements

### Hosted instance, first settlement

```bash
curl -s "https://horizon-testnet.stellar.org/transactions/1da6f9e6a90b78da898c99dfefba8821b5f632b72f584968fb057fd8a298e039" \
  | python3 -c \
  "import json,sys; \
  d=json.load(sys.stdin); \
  print('successful:', d['successful']); \
  print('ledger:', d['ledger']); \
  print('fee_account:', d['fee_account']); \
  print('fee_charged:', d['fee_charged'])"
```

Expected:

```
successful: True
ledger: 3898493
fee_account: GBUCR6H22CZC5OYHBJIEUS2JFZBOB63AHEGTCV6UEPMD2TMLKG2ZMIW4
fee_charged: 28711
```

`fee_account` is the facilitator's sponsor, not the buyer. That is
`areFeesSponsored: true` shown on-chain rather than asserted.

### Policy-governed smart account

The most useful settlement to verify: a smart-account payment where the
spending-limit policy ran inside `__check_auth`.

```bash
curl -s "https://horizon-testnet.stellar.org/transactions/a48818609704818b6e81c6c67c2e89bbace37d49b17819bf684eb6ad1da1d5a0" \
  | python3 -c \
  "import json,sys; \
  d=json.load(sys.stdin); \
  print('successful:', d['successful']); \
  print('ledger:', d['ledger']); \
  print('fee_charged:', d['fee_charged'])"
```

Expected:

```
successful: True
ledger: 3892914
fee_charged: 85999
```

> **Note:** This settlement predates the current channel pool, so its
> `fee_account` is `GAJS3G2D...`, an earlier sponsor, rather than the current
> production one. The fee payer is the facilitator either way: the buyer's
> address appears in neither field. The 85,999 figure is the measured real cost
> of a policy-governed payment, not a simulation estimate. See
> [Fees and Sponsorship](./fees.md).

### e2e suite, six settlements

Six payments settled through the Vellar facilitator by the upstream
`x402-foundation/x402` e2e suite using stock, unmodified clients. These are the
wire-level conformance evidence.

Suite HEAD `241df66`, run 2026-09-08. All six charged `fee_charged` 23,059 to
`GBUCR6H22CZC5OYHBJIEUS2JFZBOB63AHEGTCV6UEPMD2TMLKG2ZMIW4`.

| # | Client + Server | Hash | Ledger |
|---|---|---|---|
| 1 | fetch + express | `b6712023355eaae20636da32a23909d0c74204ed0f6e46a6c6a10c06f4223ca4` | 4561546 |
| 2 | axios + express | `55c3026db406de06d3e24e93ec3a3c57f87ac10bd9bbbc10ab60cb78fc79132b` | 4561549 |
| 5 | fetch + hono | `ed32fe90f4bb2d882919601f5b8706da6cf8420a9f91ee3f765223a9a6c8c670` | 4561559 |
| 6 | axios + hono | `555d7538c0c81e590a2a32a1c9039bea412dcca23d72baae82711b38856fa733` | 4561562 |
| 7 | fetch + fastify | `22b97394a8bd99eeacf113cad9d13e390dd8b664cb163be9982e868ffed361c3` | 4561568 |
| 8 | axios + fastify | `b401ff7bc5c6c5774781588b4f16c2f4a4dff5ae235fa63c7129024d1eeb8a4a` | 4561571 |

Verify any one of them, printing both account fields:

```bash
curl -s "https://horizon-testnet.stellar.org/transactions/b6712023355eaae20636da32a23909d0c74204ed0f6e46a6c6a10c06f4223ca4" \
  | python3 -c \
  "import json,sys; \
  d=json.load(sys.stdin); \
  print('successful:', d['successful']); \
  print('ledger:', d['ledger']); \
  print('source_account:', d['source_account']); \
  print('fee_account:', d['fee_account']); \
  print('fee_charged:', d['fee_charged'])"
```

Expected:

```
successful: True
ledger: 4561546
source_account: GBG5UKF4EXHYOFQFHOO263NTZRFUSXKBRUOAPDZEKISA7CPLABH7ONV4
fee_account: GBUCR6H22CZC5OYHBJIEUS2JFZBOB63AHEGTCV6UEPMD2TMLKG2ZMIW4
fee_charged: 23059
```

These settlements are fee-bumped: `source_account` is a channel account from the
pool and `fee_account` is the sponsor. The buyer's address appears in neither,
which is the non-custodial property to check.

## Upto scheme settlements

The `upto` scheme settles the actual metered amount rather than the signed
ceiling.

```bash
# Settlement 1
curl -s "https://horizon-testnet.stellar.org/transactions/be72877332bbd7f8d38511cccf00620fb20869cfedbc7530588ca856ac646d9a" \
  | python3 -c \
  "import json,sys; \
  d=json.load(sys.stdin); \
  print('successful:', d['successful']); \
  print('ledger:', d['ledger']); \
  print('fee_charged:', d['fee_charged'])"
# successful: True, ledger: 4252896, fee_charged: 39949

# Settlement 2
curl -s "https://horizon-testnet.stellar.org/transactions/72c816a63ab9da21b1403ff5199e4f21b9947c0769c55312a8cf0dc7e6ecf3db" \
  | python3 -c \
  "import json,sys; \
  d=json.load(sys.stdin); \
  print('successful:', d['successful']); \
  print('ledger:', d['ledger'])"
# successful: True, ledger: 4250665

# Settlement 3 — the first settlement through the Vellar-authored contract
curl -s "https://horizon-testnet.stellar.org/transactions/be33bb71b0a2c74c465bf0243c45e081bc7c5b66a337e2d8a5c0bbb82f54ede6" \
  | python3 -c \
  "import json,sys; \
  d=json.load(sys.stdin); \
  print('successful:', d['successful']); \
  print('ledger:', d['ledger']); \
  print('fee_charged:', d['fee_charged'])"
# successful: True, ledger: 4587956, fee_charged: 40144
```

Settlement 3 ran on 2026-09-09 against contract
`CCZL7CTRS6GWEYXDYD54DZM3OUHQW2S2A4KSU75SH275P3SFZLL4YQAN`, against a signed
ceiling of 0.05 USDC with 0.01 USDC actually settled. That gap is the whole
point of the scheme: the buyer authorized the ceiling, and the chain moved only
the metered amount.

> **Note:** Settlement 2 used the F11 test sponsor account
> (`GBOC2UOB7UI3LW2JDRSJQVCGI7SN7QD7AWELYCSNFY6GEWD4EPED6U3Y`) rather than the
> current production sponsor. The fee payer is still the facilitator, so the
> non-custodial property holds either way.

## The upto contract

The deployed wasm hash is checkable against the published source.

```bash
stellar contract fetch \
  --id CCZL7CTRS6GWEYXDYD54DZM3OUHQW2S2A4KSU75SH275P3SFZLL4YQAN \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  --out-file fetched.wasm

shasum -a 256 fetched.wasm
# expect:
# 92365d9e5effe046a1db5b959bd2357672aef3f4b2137653c8095a0764d1f6c8
```

That hash is what builds reproducibly from `contracts/upto-vellar/` in the
facilitator repo, Vellar's own implementation of the scheme:

```bash
cd contracts/upto-vellar
stellar contract build
shasum -a 256 target/wasm32v1-none/release/x402_upto_vellar.wasm
# 92365d9e5effe046a1db5b959bd2357672aef3f4b2137653c8095a0764d1f6c8
```

Built with rustc 1.96.0 and stellar-cli 26.1.0, targeting `wasm32v1-none`. See
[upto](../upto.md).

The facilitator repo also retains `contracts/upto-stellar/`, a vendored
Apache-2.0 upstream contract kept for reference, whose wasm hashes to
`c276b905981eab91704ce9b9046ebb4867b164dd7e4ba0e0ecda841527d398a9`. It is not
the contract verified above, and it is what the hosted facilitator still serves
until it is redeployed. The same source built by its upstream author, testnet
contract `CCMM3FMGEH7FHRYXZ3WQDQCTIWDXGZBGW7D4UT7NKH34SUQACYC3U54X`, hashes to
`a19f563e764dfd52a0d229c063e7ac1a1b36f6a976f552a8e19b91ee8e4ef84a` instead,
because it was built with stellar CLI 27.0.0, the version stamped in its wasm
metadata, while ours was built with stellar CLI 26.1.0 and rustc 1.96.0; the CLI
writes its version into the wasm's `contractmetav0` section and the newer
toolchain emits different code, so the two artifacts cannot share a hash even
though their contract interface and protocol sections are byte-identical.

## The F11 security finding

The ownership-hijack vulnerability was reproduced and then fixed in a controlled
A/B test on 2026-08-08 UTC. Four transactions, same accounts, same URL, with
only the code differing between the pairs.

All four used the F11 test sponsor
`GBOC2UOB7UI3LW2JDRSJQVCGI7SN7QD7AWELYCSNFY6GEWD4EPED6U3Y`, not the current
production sponsor, and each charged `fee_charged` 23,067.

| # | What happened | Hash | Ledger |
|---|---|---|---|
| Pre-fix #1 | Legitimate settle to merchant A | `f7ea48f3070e9ad7e04bb61ffc95433ec4b0fac59befa74078ffad985603d0a2` | 4040686 |
| Pre-fix #2 | Hijack: same URL, attacker `payTo`, catalog entry overwritten | `d56dc927a7c7c019197017b6a3dd92c198d9dce0d9d35749d8dbc896d0c4160d` | 4040689 |
| Post-fix #1 | Legitimate settle to merchant A | `c16af8224c474901b8fbf513b839926ddfb50707dc283a19f5f8629a24f028b3` | 4040704 |
| Post-fix #2 | Identical attack: payment settled, catalog unchanged | `a909e4748c83f55972d6cee3286b8627c304b231037c7daae51d869bf17f1d38` | 4040706 |

```bash
# Pre-fix hijack
curl -s "https://horizon-testnet.stellar.org/transactions/d56dc927a7c7c019197017b6a3dd92c198d9dce0d9d35749d8dbc896d0c4160d" \
  | python3 -c \
  "import json,sys; \
  d=json.load(sys.stdin); \
  print('successful:', d['successful']); \
  print('ledger:', d['ledger']); \
  print('fee_charged:', d['fee_charged'])"
# successful: True, ledger: 4040689, fee_charged: 23067

# Post-fix, the blocked attack
curl -s "https://horizon-testnet.stellar.org/transactions/a909e4748c83f55972d6cee3286b8627c304b231037c7daae51d869bf17f1d38" \
  | python3 -c \
  "import json,sys; \
  d=json.load(sys.stdin); \
  print('successful:', d['successful']); \
  print('ledger:', d['ledger']); \
  print('fee_charged:', d['fee_charged'])"
# successful: True, ledger: 4040706, fee_charged: 23067
```

> ⚠️ **Both attack payments settled on-chain.** "Blocked" means the catalog
> refused to update, protecting the legitimate seller's entry and trust stats,
> not that the payment failed. The control matters: without the pre-fix run
> showing the hijack actually worked, "blocked" would be indistinguishable from
> a settlement that broke for unrelated reasons.

## Upstream contributions

Nothing merged at time of writing. Both PRs are signed and verified.

| Contribution | Status |
|---|---|
| x402-foundation/x402 PR #3428, upto convergence spec, 349 lines | Open, signed, 0 reviews |
| stellar/stellar-docs PR #2836, community facilitators section | Open, ready for review |
| x402-foundation/x402 issue #3125, settle discards RPC status | Fix in progress via PR #3293 by wakqasahmed |
| x402-foundation/x402 issue #3158, canonical client cannot sign for smart accounts | Open |

## What is not proven here

These claims exist in the codebase but cannot be verified from outside it:

- The test suite results
- The security audit findings and their resolution
- The search evaluation, which is small and unmeasured (see
  [Honesty](./honesty.md))
- Pubnet: no mainnet settlement exists, and no mainnet hash is claimed anywhere
  on this site

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| A hash returns 404 on Horizon | Querying pubnet Horizon rather than testnet | Every hash here is Stellar **testnet**; use `horizon-testnet.stellar.org` |
| The first facilitator call hangs | Free-tier cold start after 15 minutes idle | Allow up to 120 seconds; warm with `GET /health` first |
| `fee_account` shows an address you do not recognise | Older settlements used earlier sponsors, and the F11 test used its own | Check it against the sponsor named in that section. The test is that it is never the buyer |
| `stellar contract fetch` is not found | The Stellar CLI is not installed | Install it, or skip the contract check: every other command needs only curl and python3 |

## Next steps

- [Conformance](./conformance.md)
- [Fees and Sponsorship](./fees.md)
- [Honesty](./honesty.md)
- [The payment loop](../concepts/payment-loop.md)
