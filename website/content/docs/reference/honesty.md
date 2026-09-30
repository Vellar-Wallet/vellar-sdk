# Honesty

> Every limitation, dead end, and known gap on one page. If something does not
> work today, it is on this page.

By the end of this page you will know exactly what Vellar does not do today,
what the spending-limit policy cannot enforce, what mainnet is actually gated
on, and what "verified" does and does not mean.

## What the spending-limit policy enforces, and what it does not

The spending-limit policy runs inside `__check_auth` and validates two things:
the token and the amount. It enforces how much an agent can spend per window.

> ⚠️ **The policy has no opinion on the recipient.** "The agent cannot exceed
> its budget" is true. "The agent's funds are protected" is not. A payment
> redirected to a different address within the cap satisfies the policy
> completely. Guarding the recipient is your application's responsibility, not
> the chain's.

The window is fixed and tumbling, not sliding. When it elapses, spent resets to
zero. Spending timed around a boundary can therefore move up to 2x the cap in a
short span: 100 XLM per day means up to 200 XLM if an agent spends the cap just
before the reset and again just after. Treat the limit as an on-chain guardrail,
not a to-the-stroop hard cap. For a hard guarantee the contract itself
recommends pairing it with a cryptographic co-signer.

## The spend ceiling accounts at the estimate, not the charge

The facilitator's global spend ceiling (5 XLM per window by default) is
accounted at the spend estimate of 500,000 stroops per settlement, not at the
actual charge, which is roughly 23,000 stroops for a keypair payment. So the
ceiling trips after roughly 100 settlements per window while actually spending
about 0.23 XLM of the 5 XLM it names.

This is a known open item for pubnet tuning. It fails safe: the ceiling is more
conservative than it needs to be rather than less. The correct fix is to account
at the measured charge rather than the estimate, which requires pubnet data that
does not exist yet. See [Fees and Sponsorship](./fees.md) for the difference
between the estimate, the bid and the charge.

## What "verified" does and does not mean

The verified-only policy restricts an agent to contracts whose source is
reproducibly verified against the deployed wasm. That is provenance, not an
audit.

Verified means:

- The contract's source code is attributable and reproducible.
- The deployed bytes match a published wasm hash.
- The source can be built and compared.

Verified does not mean:

- The code has been audited for safety.
- The contract has no vulnerabilities.
- A payment to a verified contract is safe.

## The passkey signer does not settle today

`createPasskeyX402Signer` produces a correct signature shape, but no deployed
facilitator currently accepts human passkey-signed x402 payments. Build on
`createSessionKeySigner` for any flow that needs to actually settle.

This is a current limitation with no committed timeline, not a planned one.

## wallet.x402 cannot pay upto

`wallet.x402.fetch()` speaks the `exact` scheme only. A seller accepting only
`upto` cannot be paid by SDK buyers today, so advertise both schemes until
`upto` wallet support lands.

## The verification field is always "unknown"

The `verification` and `acceptsVerification` fields in catalog entries are
always `"unknown"` on every deployment. They read from an external attestation
service that is deployed nowhere, which is architectural rather than an outage.

> ⚠️ **Do not filter on `verified_only=true`.** The filter is refused with a
> 400, and the refusal names `ownerVerified` as the signal that does work. Use
> that instead. See [Bazaar and
> discovery](../concepts/bazaar-and-discovery.md).

## The semantic search arm fails silently

Search uses a hybrid pipeline: a lexical arm and a Voyage AI semantic arm fused
by RRF. When the Voyage AI API is unavailable, the semantic arm is skipped and
the endpoint returns lexical-only results with no indication in the response
that the semantic stage was missing.

A query that returns weak results during a Voyage outage returns better results
once the service recovers, with no change in the response shape.

This is documented in [Search and
Retrieval](../architecture/search-and-retrieval.md).

## The catalog is ephemeral on the hosted instance

The free-tier hosted instance has no persistent disk. The catalog resets on
every restart, and `ownerVerified` data resets with it. A resource re-catalogs
after its next settled payment, and `ownerVerified` self-heals the same way.

A payment still settles on-chain when the catalog is empty. Cataloging and
settlement are independent.

## Mainnet readiness

**The hosted facilitator now advertises `stellar:pubnet`.** This is not a
prediction or a plan — it is what the live service returns. Verified 2026-09-30:

```console
$ curl -s https://vellar-facilitator-production.up.railway.app/supported
{"kinds":[{"scheme":"exact","network":"stellar:pubnet",...},
          {"scheme":"upto","network":"stellar:pubnet",...}]}
```

The `catalogAssets` map in that same response carries **both** networks:

| Network | USDC SAC contract |
| --- | --- |
| `stellar:testnet` | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| `stellar:pubnet` | `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75` |

The pubnet address is the genuine Circle-issued mainnet USDC contract, confirmed
against `horizon.stellar.org`.

> ⚠️ **Payments on the hosted facilitator now move real money.** A payment
> settled against `stellar:pubnet` spends real USDC from a real account. Earlier
> revisions of this page said "testnet only" because that was true when
> written; it is not true now. If you are following a tutorial, **check which
> network the facilitator advertises before you pay**, and set your network
> explicitly rather than relying on a default. The demo seller quotes **1.00 real
> USDC** on pubnet, not a testnet amount.

### Which network a call lands on

The network is chosen by what the server advertises and what the SDK is
configured for — there is no hidden switch. Two things to check:

- `GET /supported` tells you what the facilitator is currently serving. If it
  advertises `stellar:pubnet`, assume **real funds**.
- The SDK's network configuration (`NETWORK`, `caip2`, `VELLAR_NETWORK`) must
  match, or the guards refuse the payment rather than misroute it.

A mismatch fails closed: the guard layer rejects a challenge whose `network` is
not the one you configured. The dangerous case is not a mismatch — it is a
correct-looking configuration pointed at a facilitator that has since moved to
pubnet.

### Mainnet gate status

The three gates previously listed, with their actual state as of 2026-09-30:

| Gate | Status |
| --- | --- |
| A persistent-disk deployment | **Cleared.** The hosted instance is a Railway deployment, and the catalog persists across restarts. |
| A funded pubnet sponsor account | **Cleared.** `/supported` advertises `stellar:pubnet` and the demo seller settles against mainnet USDC. |
| A mainnet security audit of the spending-limit policy contract | **NOT cleared.** This is the one gate still open. |

> ⚠️ **The spending-limit policy contract has not had its mainnet security
> audit.** The pre-mainnet security review covered the facilitator service and
> its cryptographic validation; the policy contract is separate work and remains
> unaudited. This is the item to weigh before pointing a production agent at
> pubnet with a smart account and a spending policy.

The one gate that was still open is also the one that matters most for the
spending-limit path. Settlement on pubnet is live; **policy safety on pubnet is
not audited.**

## What the security review covered

The pre-mainnet security review covered the facilitator service and its
cryptographic validation. The spending-limit policy contract is not covered by
that review: it is separate work, and it is still unaudited for pubnet. See
[Mainnet readiness](#mainnet-readiness).

## The upto scheme is experimental

The `upto` wire format may change before upstream settles on a standard, so do
not build production systems against it expecting stability. See
[x402-foundation/x402 PR #3134](https://github.com/x402-foundation/x402/pull/3134)
for the upstream standardization effort.

`upto` settlement is also not wired into the channel-account pool, so concurrent
`upto` settlements can fail with `txBadSeq`. Serialize them.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| A payment within the cap went to the wrong address | The policy validates the token and amount, never the recipient | Guard the recipient in your application before signing |
| More than the cap moved in a short span | The window tumbles rather than slides, so up to 2x can move around a boundary | Size the window for that worst case, or pair the limit with a co-signer |
| A passkey-signed x402 payment never settles | No deployed facilitator accepts them | Use `createSessionKeySigner` |
| An `upto`-only seller cannot be paid by an SDK buyer | `wallet.x402` is exact-only | Advertise both schemes |
| `400 verified_only_unavailable` | `verification` is always "unknown", so the filter is refused | Filter on `ownerVerified` instead |
| The catalog is empty after a restart | The hosted free tier has no persistent disk | Re-catalog with a settled payment, or run your own instance |
| `txBadSeq` on concurrent `upto` settlements | Not wired into the channel-account pool | Serialize `upto` settlements |
| A payment moved real USDC when you expected testnet | The hosted facilitator now advertises `stellar:pubnet` | Check `GET /supported` before paying, and configure the network explicitly |

## Next steps

- [Agent keys](../agent-tooling/agent-keys.md)
- [Policies](../agent-tooling/policies.md)
- [Spend controls](../buyers/spend-controls.md)
- [Security](../security.md)
