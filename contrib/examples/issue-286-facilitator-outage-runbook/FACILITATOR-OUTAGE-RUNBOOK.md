# Runbook: vellar-facilitator outage

Contributed for [issue #286](https://github.com/Vellar-Wallet/vellar-sdk/issues/286).

> **Placement note.** The issue asks for this runbook to live "alongside
> CONTRIBUTING.md" — i.e. at the repo root. Contributor PRs may only touch
> files under `contrib/` (see [CONTRIBUTING.md](../../../CONTRIBUTING.md) and
> [contrib/README.md](../../README.md)), so this is submitted here for
> review; a maintainer can move it to the repo root (e.g.
> `FACILITATOR-OUTAGE-RUNBOOK.md`) as part of merging.

This runbook describes how to recognize and respond to a degraded or
unreachable [vellar-facilitator](https://github.com/Vellar-Wallet/vellar-facilitator)
service. The facilitator is the shared infrastructure that verifies and
settles x402 payments; when it is degraded, the SDK's x402 payment path
(`x402-client.ts`, `x402-facade.ts`) and the `@vellar/mcp-x402-payer` MCP
server are directly affected. Wallet creation, connection, and non-x402
transaction submission (`http-backend.ts`, `tx-rpc.ts`) go through your own
gateway and Soroban RPC instead, and are **not** affected by a facilitator
outage on their own.

## 1. Detection signals

A facilitator outage typically shows up as one or more of the following.

### Consumer-side (SDK / mcp-x402-payer)

- A sudden spike in payment failures where the **same resource and asset**
  that settled a moment ago now fails on every attempt.
- `x402_pay` (in `@vellar/mcp-x402-payer`) reporting `SettlementFailedError`
  after exhausting its 3 retries, especially when the underlying HTTP
  responses are `402` with `settle.success === false` and an **empty**
  `transaction` field — the facilitator's own signal that it released its fee
  reservation because it never got as far as submitting (see the failure
  taxonomy in [mcp-x402-payer's README](../../../packages/mcp-x402-payer/README.md#the-failure-taxonomy-measured-not-assumed)).
- Requests to the facilitator's discovery/quote endpoints timing out or
  returning 5xx, rather than a well-formed 402 challenge.
- `NoUsablePaymentOptionError` or `InvalidRequirementsError` thrown from
  `x402-client.ts` where the challenge itself looks malformed or empty,
  rather than a legitimate refusal (over budget, disallowed asset, etc).

### Direct signals

- The facilitator's own health endpoint, if you have one configured for
  monitoring, returning non-200 or timing out.
- Elevated latency or error rate on the facilitator's `/settle` and
  `/verify` routes if you have request-level metrics on outbound calls to it.

### What is *not* a facilitator outage

Don't over-attribute — these look similar but have different causes and fixes:

| Symptom | Likely cause | Not a facilitator outage because |
| --- | --- | --- |
| `MaxAmountExceededError` | Price rose above the caller's `max_amount` | Facilitator is answering correctly, just with a higher price |
| `DisallowedAssetError` | Resource requests an asset outside your allowlist | Local configuration, not availability |
| `SessionCeilingExceededError` | Per-session spend cap reached (mcp-x402-payer) | Local guard, not facilitator-side |
| Policy rejection (`Error(Contract, #1)` under `policy__`) | On-chain spending-limit policy refused the payment | Chain-side refusal, facilitator did its job correctly |
| One-off `402` with non-empty `transaction` | Settlement was submitted and failed on-chain (fees charged) | A single terminal failure, not systemic unavailability |

A genuine outage is distinguished by **persistence and breadth**: multiple
distinct resources, assets, and/or consumer instances failing the same way
over a sustained window, not a single request or a single over-budget call.

## 2. Consumer-facing guidance

If you operate a service or agent built on this SDK, here is what to expect
and do during a facilitator outage.

### Expected SDK error types

| Error | Where it's thrown | What it means during an outage |
| --- | --- | --- |
| `SettlementFailedError` | `@vellar/mcp-x402-payer` (`errors.ts`) | All retries exhausted with no settlement transaction returned. Safe to treat as **nothing was spent** — the session ledger is only debited on confirmed settlement. |
| `IndeterminateSettlementError` | `@vellar/mcp-x402-payer` (`errors.ts`) | The response was unreadable (malformed hash, or a 2xx with no settle info). Treated as spent for safety; check the payer account on-chain before retrying manually. |
| `NoUsablePaymentOptionError` | `src/x402-types.ts`, via `x402-client.ts` | The challenge advertised no option this client could use — check whether the challenge itself is malformed rather than assuming a normal refusal. |
| `InvalidRequirementsError` | `src/x402-types.ts` | The 402 challenge body failed schema validation. During an outage, degraded facilitators sometimes return truncated or malformed challenges. |
| Generic network errors (`fetch` rejecting, timeouts) | Anywhere the SDK or mcp-x402-payer calls the facilitator over HTTP | The facilitator is unreachable outright. |

None of these indicate a problem with your wallet, your key, or your on-chain
balance. Do not rotate keys or redeploy your smart account signer in
response to a facilitator outage.

### What to do

1. **Stop retrying aggressively.** `@vellar/mcp-x402-payer` already retries
   settlement up to 3 times with fresh signed payloads; additional
   application-level retry loops on top of that mostly add load to an
   already-degraded service. Back off (see the
   [`x402-retry-backoff-demo`](../x402-retry-backoff-demo/) example for a
   pattern) rather than tight-looping.
2. **Do not increase `max_amount` or session ceilings** to "force" a payment
   through. A facilitator outage is not a budget problem, and this action
   only widens what a subsequent successful call could spend.
3. **Check on-chain state before manually retrying a payment** if you saw
   `IndeterminateSettlementError` or a `402` response with a non-empty
   `transaction` — fees may have already been charged, and retrying blindly
   can pay twice.
4. **Fall back to non-x402 flows where possible.** Wallet creation,
   connection, and direct transaction submission via your own gateway
   (`http-backend.ts`) and Soroban RPC (`tx-rpc.ts`) do not depend on the
   facilitator and can continue to work during an x402-specific outage.
5. **Surface the outage to your own users/operators** rather than silently
   swallowing errors — a payment feature that is down should say so, not
   appear to hang.

## 3. Escalation

If detection signals above persist for more than a few minutes across
multiple resources or consumers:

- Check the [vellar-facilitator repository](https://github.com/Vellar-Wallet/vellar-facilitator)
  for open issues or a status announcement.
- Report the outage in the maintainers' [Telegram group](https://t.me/+RWPCKXXJTj45Njk0)
  (the same channel CONTRIBUTING.md directs questions to), including:
  - approximate start time and duration observed,
  - the facilitator URL / environment affected (mainnet vs testnet, self-hosted vs shared),
  - a representative failed request (resource URL, asset, HTTP status, and
    `settle` header if available — **never** include your payer secret or
    signed transaction payloads),
  - which error types you're seeing from the table above.
- For the shared hosted facilitator specifically, escalate through the
  channel the Vellar team designates for infrastructure incidents; check the
  [vellar-facilitator repository](https://github.com/Vellar-Wallet/vellar-facilitator)
  README for the current incident-reporting process, since that may change
  independently of this SDK.

Do not open a `vellar-sdk` issue for a facilitator-side outage — the SDK
repository does not operate the facilitator service, and reports here won't
reach whoever can act on them. Use the facilitator repository or the
Telegram group instead.
