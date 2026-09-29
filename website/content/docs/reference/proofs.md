# Proofs

> Every verifiable claim on this site, indexed on one page with copy-paste curl
> commands. Nothing here requires trusting us: every hash resolves
> independently on Horizon.

By the end of this page you will have independently verified that Vellar settles
real payments on Stellar testnet and mainnet, that fees are paid by the
facilitator and not the buyer, that the `upto` contract is reproducible from
published source, and that the F11 security fix works exactly as claimed.

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
BASE=https://vellar-facilitator-testnet-production.up.railway.app

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

> **Note:** `/health` is exempt from the rate limit, so prefer it for liveness
> checks rather than hammering `/supported`.

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

## Mainnet settlements (stellar:pubnet)

A mainnet facilitator is deployed at `https://vellar-facilitator-production.up.railway.app`
and has settled real USDC payments on `stellar:pubnet`. Eleven confirmed
settlements, 2026-09-17 to 2026-09-21, totaling roughly 3.6 USDC, all charged
to the mainnet sponsor `GBB7PVDR642MJSALMD3PN4SAPZHUJP555XQMFJJNUH3AN33UQY7FVL3H`
against the mainnet USDC SAC
`CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75`. These are exact-scheme
settlements — the same wire format verified against testnet above, now proven
against pubnet.

| # | Hash | Ledger |
|---|---|---|
| 1 | `7288cd138c5e2770784738b2903b3728f049f659d3d6da42e19976783edefef3` | 64473073 |
| 2 | `b6898a10abebce5de92b9610fadfac470c48379bffdefb9ce81b581f4e0d3c07` | 64474688 |
| 3 | `6ec03c83e5d7a45ed87603fae5dea18f4c205f65ff73e5fcef6614b606001275` | 64478864 |
| 4 | `3b40e5b23d52388c7905b3a46b31c5e0b709e0b8a4a95125ac674937cbe37925` | 64500684 |
| 5 | `237c91c3044dfc66e7498096637c10ce65041e7a744d9cd65a0cbc3f9d29c1f7` | 64507904 |
| 6 | `09b24dc9fb78c5596cb780fee26c57bb17d5eee0e9cc7035ebae938e54752a14` | 64512734 |
| 7 | `a2d6ee5eab785d6b5a5401028fa7ba414d8b2a6cac0a3568b3f8a8cf98f87f57` | 64517288 |
| 8 | `babb0a72bcb94e80be61dff1fa56ec9a5ebd45c62caa139e03076ced5f55962f` | 64524041 |
| 9 | `3401e34161883219abd3543752f19731fba39b31c108119add8138903ad0d742` | 64524446 |
| 10 | `f5137a9cf90c39bd6680eb5dae3548a0ee2e2b0dffec059072e72882709cefe0` | 64524688 |
| 11 | `4abe6af7e71acb3ceea0fa30a9649768e05d2efb67e04f573112e214a40db458` | 64541455 |

Verify any one of them against **mainnet** Horizon — note the different host
from every other command on this page:

```bash
curl -s "https://horizon.stellar.org/transactions/7288cd138c5e2770784738b2903b3728f049f659d3d6da42e19976783edefef3" \
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
ledger: 64473073
fee_account: GBB7PVDR642MJSALMD3PN4SAPZHUJP555XQMFJJNUH3AN33UQY7FVL3H
fee_charged: 23565
```

`fee_account` is the mainnet sponsor, not the buyer — the same non-custodial
property as every testnet settlement on this page, now shown with real funds.

> **Note:** These are the only mainnet settlements claimed anywhere on this
> site. "What is not proven here" below is updated accordingly: mainnet
> settlement is no longer unproven, but everything else in that section still
> is.

## Upto scheme settlements

The `upto` scheme settles the actual metered amount rather than the signed
ceiling.

Settlements 1 and 2 ran through the previous contract
(`CDHPA64M73TUTEM4MMHIWIXINBQXH7JJXFGZMGH22VJWFJFROMR6QV2S`). The current
contract's first settlement is settlement 3,
`be33bb71b0a2c74c465bf0243c45e081bc7c5b66a337e2d8a5c0bbb82f54ede6` at ledger
4587956.

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

## Testnet traction

Two independent sources report testnet usage, and they disagree by design, not
by error — the gap tells you what the smaller number leaves out.

The **Bazaar catalog** counts settlements only for resources tagged with the
discovery extension. Sum `trust.settlements` across every entry and you get
the number below, which you can reproduce yourself with no facilitator trust
required beyond the read itself:

```bash
curl -s "https://vellar-facilitator-testnet-production.up.railway.app/discovery/resources?limit=100" \
  | python3 -c \
  "import json,sys; \
  d=json.load(sys.stdin); \
  items=d['items']; \
  print('resources:', len(items)); \
  print('sum of settlements:', sum((i.get('trust') or {}).get('settlements',0) for i in items))"
```

Expected:

```
resources: 20
sum of settlements: 371
```

The **operator console**, at `vellar-admin-console-production.up.railway.app`,
reads the full settlement audit log rather than the Bazaar-tagged subset — it
counts every settlement type, including ones whose payload never carried the
discovery extension and so never entered the catalog above. As of this
writing it reports:

- **390** total testnet settlements
- **303** unique buyers
- **4** sellers
- Period: 2026-08-20 to 2026-09-29

The console renders client-side, so it isn't a bare `curl` target the way the
catalog endpoint is — check it in a browser to see the current numbers
yourself. Both 371 and 390 are real: 371 is what the public catalog can prove
about Bazaar-discoverable resources specifically, and 390 is the fuller
operational count the smaller number is a subset of.

## Ecosystem recognition

Vellar is listed in the official Stellar developer documentation as a
community x402 facilitator, under Build → Agentic Payments → x402.

**stellar/stellar-docs PR #2836** — "docs: add Vellar x402 facilitator to
Stellar ecosystem" — merged 2026-09-28.

```bash
# The merge is on GitHub, not Horizon — check the PR itself.
# https://github.com/stellar/stellar-docs/pull/2836
```

Verify it yourself: open the PR, confirm the merged state and merge date.

## Upstream contributions

Of the four contributions below, one has since merged — see Ecosystem
recognition above. The other three remain open.

| Contribution | Status |
|---|---|
| x402-foundation/x402 PR #3428, upto convergence spec, 349 lines | Open, signed, 0 reviews |
| stellar/stellar-docs PR #2836, community facilitators section | **Merged** 2026-09-28 |
| x402-foundation/x402 issue #3125, settle discards RPC status | Fix in progress via PR #3293 by wakqasahmed |
| x402-foundation/x402 issue #3158, canonical client cannot sign for smart accounts | Open |

## What is not proven here

These claims exist in the codebase but cannot be verified from outside it:

- The test suite results
- The security audit findings and their resolution
- The search evaluation, which is small and unmeasured (see
  [Honesty](./honesty.md))
- The testnet operator console's 390/303/4 figures — real, but the console
  renders client-side rather than serving a plain `curl`-able JSON endpoint,
  so verifying them yourself means opening it in a browser, not copy-pasting a
  command from this page
- Mainnet volume beyond the 11 settlements above: those are the only mainnet
  hashes claimed on this site, and 3.6 USDC total. Every other transaction
  hash on this page is Stellar testnet

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| A hash returns 404 on Horizon | Querying the wrong network's Horizon | Every hash on this page is Stellar **testnet** (`horizon-testnet.stellar.org`) **except** the 11 in Mainnet settlements, which use `horizon.stellar.org` |
| `fee_account` shows an address you do not recognise | Older settlements used earlier sponsors, and the F11 test used its own | Check it against the sponsor named in that section. The test is that it is never the buyer |
| `stellar contract fetch` is not found | The Stellar CLI is not installed | Install it, or skip the contract check: every other command needs only curl and python3 |

## Next steps

- [Conformance](./conformance.md)
- [Fees and Sponsorship](./fees.md)
- [Honesty](./honesty.md)
- [The payment loop](../concepts/payment-loop.md)
