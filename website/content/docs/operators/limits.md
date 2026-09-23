# Limits and Operations

> The operational limits of the hosted instance, what each one means, and how to handle them without debugging things that are not bugs.

By the end of this page you will know the six things that will bite you on the hosted instance, understand the cold-start timing, know which spend-control refusals are enforced versus logged, and know how to keep the catalog healthy.

## Prerequisites

- `curl` and `python3` on your path.
- Node 20 or later if you want to run your own instance from the section at the bottom.
- Familiarity with the payment loop, since most of the failure modes here happen during verify or settle. See [The payment loop](../concepts/payment-loop.md).

## The hosted instance

```
https://vellar-facilitator.onrender.com
```

Network: `stellar:testnet` only. Tier: free, on Render.

> ⚠️ **This is not production infrastructure.** It is a testnet demo: one instance, no uptime commitment, no persistent disk, and a cold start possible at any hour. It is fine for building and testing against. For anything real, run your own instance (see [Run your own facilitator](./run.md)).

## The six things that will bite you

### 1. Cold start (about 45 seconds)

The instance sleeps after 15 minutes idle. The first request after idle takes roughly 45 seconds. That is a Render free-tier characteristic, not a bug and not a sign the facilitator is broken.

Send a warming request before the request you actually care about:

```bash
curl -s --max-time 120 https://vellar-facilitator.onrender.com/health
```

> **Note:** `/health` is exempt from rate limiting, so warming costs you nothing against your budget. Once warm, the service stays active for 15 minutes past the last call.

### 2. Settlement failures, retry rather than debug

`/settle` occasionally returns an empty `transaction` field with one of two reason codes:

- `settle_exact_stellar_transaction_submission_failed`
- `settle_exact_stellar_transaction_failed`

Both mean the same thing: the transaction was never submitted, nothing was spent, and a retry cannot double-pay. Sign a fresh payload and retry once.

> ⚠️ **A non-empty `transaction` field is the opposite case.** It means fees were charged and the settlement failed on-chain after submission. Do not retry that one.

The facilitator already retries internally (two attempts, 6 seconds apart) before returning the error, so what you receive is the verdict after those retries.

### 3. The catalog is ephemeral

The free tier has no persistent disk. The catalog resets on every restart and on every idle-sleep recovery.

A resource re-catalogs after its next settled payment, and `ownerVerified` resets and self-heals the same way. Cold start does not just mean latency, it means data loss.

### 4. Your first settlement writes permanently

The catalog is global to the facilitator. A `localhost` URL produces a permanent, unremovable entry that is permanently unverifiable (verification is https only, no loopback). There is no self-service removal.

Use a local facilitator for development. `seller.mjs` refuses to boot with a `localhost` URL pointed at a non-local facilitator unless `ALLOW_UNVERIFIABLE_ON_SHARED=1` is set.

> ⚠️ **The refusal is a guardrail, not an obstacle.** Overriding it with `ALLOW_UNVERIFIABLE_ON_SHARED=1` against the hosted instance leaves an entry that every other agent reading the catalog has to skip past, and nobody can remove it.

### 5. Rate limits

- 60 requests per minute per IP.
- `/verify` and `/settle` bodies are capped at 32 KiB.
- `/health` is exempt from the rate limit.

### 6. Spend-control refusals are log-only on testnet

The four spend-control refusal reasons are:

| Reason | Meaning |
| --- | --- |
| `rate_limited_payto` | The per-window settlement budget for that `payTo` is exhausted |
| `rate_limited_url` | The per-window settlement budget for that bound resource URL is exhausted |
| `spend_ceiling` | The global rolling spend ceiling for the window is exhausted |
| `unbound_pool_exhausted` | The shared per-window pool for all unbound URLs is exhausted |

On testnet these are logged as would-reject and the settlement proceeds, so you cannot test your handling of a real one there. They are enforced on pubnet.

## Reading /health

```bash
curl -s https://vellar-facilitator.onrender.com/health | python3 -m json.tool
```

| Field | What it means |
| --- | --- |
| `status` | `"ok"` means the service is up |
| `catalogSize` | Number of entries currently in the catalog |
| `reverifyPending` | Ownership re-verification checks in flight after a restart. `0` means the catalog's trust state is settled |
| `unverifiableEntries` | Count of entries whose URLs can structurally never be verified (http, loopback, route template). Non-zero means a permanent issue rather than a transient one |
| `channelPool.available` | Channel accounts available for settlement. `50` means the pool is fully healthy |
| `commit` | The git commit hash currently serving |

> **Note:** `unverifiableEntries` is absent when zero, not `0`. A healthy catalog does not carry the key at all, so check for the key's presence rather than its value. Absence means nothing is wrong.

## Running your own instance

The hosted instance is not a dependency. The code is in the facilitator repo and runs in one command.

```bash
git clone https://github.com/Vellar-Wallet/vellar-facilitator
cd vellar-facilitator
npm install
mkdir -p data
SPONSOR_SECRET_KEY=S... CHANNEL_ACCOUNT_SECRET_KEYS=S...,S...,... PORT=4100 CATALOG_DB_URL=file:./data/catalog.db npm start
```

`CHANNEL_ACCOUNT_SECRET_KEYS` must contain exactly 50 comma-separated Stellar classic secrets, and the sponsor key must not be among them. libSQL will not create the `data` directory for you, which is why `mkdir -p data` comes first.

For the full walkthrough (provisioning a testnet asset, running a seller, paying it), see [Run your own facilitator](./run.md).

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| First request hangs for about 45 seconds | The instance slept after 15 minutes idle and is cold-starting | Expected on the free tier. Send a warming `curl --max-time 120` to `/health` before the real request |
| `/settle` returns an empty `transaction` field with `settle_exact_stellar_transaction_submission_failed` or `settle_exact_stellar_transaction_failed` | The transaction was never submitted, so nothing was spent | Sign a fresh payload and retry once. A retry cannot double-pay. Do not retry if `transaction` is non-empty |
| `settlement_refused` with `sponsor_balance_low` | The sponsor account is below `SPONSOR_HARD_FLOOR_STROOPS` (default 100,000,000 stroops, 10 XLM) | Wait for the operator to refund the sponsor, or fund your own sponsor if you run the instance |
| `400 verified_only_unavailable` | You filtered discovery on `verified_only=true` and there is no verdict source | Use `ownerVerified` instead |
| `curl -I` returns a plain `200` on a paid route | HEAD carries no payment challenge, so a correctly wired route looks broken | Debug with `GET`, never `HEAD` |
| Catalog is empty after a restart | The free tier has no persistent disk, so the catalog resets on restart and on idle-sleep recovery | Nothing to fix. A resource re-catalogs after its next settled payment. Set `CATALOG_DB_URL` on your own instance for durable storage |

## Next steps

- [Run your own facilitator](./run.md)
- [Configuration reference](./configuration.md)
- [Fees and sponsorship](../reference/fees.md)
- [Bazaar and discovery](../concepts/bazaar-and-discovery.md)
