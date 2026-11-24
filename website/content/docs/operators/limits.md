# Limits and Operations

> The operational limits of the hosted instance, what each one means, and how to handle them without debugging things that are not bugs.

By the end of this page you will know the six things that will bite you on the hosted instance, understand its availability characteristics, know which spend-control refusals are enforced versus logged, and know how to keep the catalog healthy.

## Prerequisites

- `curl` and `python3` on your path.
- Node 20 or later if you want to run your own instance from the section at the bottom.
- Familiarity with the payment loop, since most of the failure modes here happen during verify or settle. See [The payment loop](../concepts/payment-loop.md).

## The hosted instance

```
https://vellar-facilitator.onrender.com
```

Network: `stellar:testnet` only. Hosted on Railway and running continuously, with no idle sleep or cold start.

> ⚠️ **This is not production infrastructure.** It is a testnet demo: one instance, no uptime commitment, and no persistent disk. It is fine for building and testing against. For anything real, run your own instance (see [Run your own facilitator](./run.md)).

## The six things that will bite you

### 1. Continuous uptime

The hosted instance runs continuously and does not sleep when idle, so requests do not need a cold-start grace period. No warming request is needed. If a request times out or fails to connect, check service and network availability rather than waiting for the facilitator to wake.

`/health` is exempt from rate limiting and can be used to check service availability.

### 2. Settlement failures, retry rather than debug

`/settle` occasionally returns an empty `transaction` field with one of two reason codes:

- `settle_exact_stellar_transaction_submission_failed`
- `settle_exact_stellar_transaction_failed`

Both mean the same thing: the transaction was never submitted, nothing was spent, and a retry cannot double-pay. Sign a fresh payload and retry once.

> ⚠️ **A non-empty `transaction` field is the opposite case.** It means fees were charged and the settlement failed on-chain after submission. Do not retry that one.

The facilitator already retries internally (two attempts, 6 seconds apart) before returning the error, so what you receive is the verdict after those retries.

### 3. The catalog is ephemeral

The hosted instance has no persistent disk. The catalog resets on every restart.

A resource re-catalogs after its next settled payment, and `ownerVerified` resets and self-heals the same way.

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

### Guaranteed versus optional fields

The parser in the SDK helper distinguishes two classes of field:

- **Guaranteed present:** `status`, `catalogSize`, `reverifyPending`, `channelPool.available`, and `commit`. These are always emitted by the facilitator, so a missing one is a genuine parse failure.
- **Documented-optional:** `unverifiableEntries` is absent when zero, not `0`. A healthy catalog does not carry the key at all, so check for the key's presence rather than its value. Absence means nothing is wrong, and the parser defaults it to `0` rather than treating it as an error.

> **Note:** The SDK health-check helper parses this response into a typed result and never throws merely because a documented-optional field is omitted. If you are hand-rolling a check, mirror that behavior: only `unverifiableEntries` is safe to treat as absent-means-zero.

## Verifying a deployment from CI

The `commit` field is the git commit hash currently serving. That makes it directly useful for a post-deploy smoke test: after you deploy your own facilitator, assert the live commit matches the one you just shipped before running integration tests against it.

The SDK exposes a `compareCommit` helper for exactly this. It compares the live `commit` field against an expected hash and reports a clear mismatch instead of silently passing:

```js
import { fetchHealth, compareCommit } from '@vellar/facilitator-sdk';

const health = await fetchHealth('https://your-facilitator.example.com');
const result = compareCommit(health, process.env.EXPECTED_COMMIT);

if (!result.matches) {
  throw new Error(
    `deploy not live: expected ${result.expected}, got ${result.actual}`,
  );
}
```

A mismatch is reported explicitly (with both the expected and actual hashes) rather than being ignored, so a stale deployment fails the CI step loudly. This is a deploy-verification aid for anyone running CI against their own self-hosted facilitator; the hosted testnet instance is not a stable target for commit assertions.

### Classifying liveness with `checkFacilitatorLiveness`

Reading the fields by hand works, but the SDK ships a wrapper that combines them into a single verdict. `checkFacilitatorLiveness` fetches `/health` with a timeout and returns one of three classifications:

| Classification | Meaning | What to do |
| --- | --- | --- |
| `unreachable` | The `/health` fetch failed or timed out. The facilitator may be down or the network may be broken | Check service and network availability, then treat it as unavailable |
| `reachable-unhealthy` | The service answered, but the documented fields report a concerning internal state | The service is up but degraded. Inspect the reported fields before sending verify or settle traffic |
| `reachable-healthy` | The service answered and every documented field is within its healthy range | Proceed |

A reachable facilitator counts as `reachable-unhealthy` when any of the following hold:

- `status` is present and is not `"ok"`.
- `channelPool.available` is `0` (no channel accounts left for settlement; `50` is fully healthy).
- `unverifiableEntries` is present and greater than `0` (a permanent catalog issue, not a transient one).

`commit` is carried through on the result so you can record which build answered, but it does not affect the classification. The `unverifiableEntries` check follows the same presence rule as the raw endpoint: the key is absent when zero, so absence is healthy.

> **Note:** `unreachable` and `reachable-unhealthy` are different failures. An `unreachable` result tells you nothing about the facilitator's internal state, so do not interpret it as a catalog or pool problem. A `reachable-unhealthy` result means the service is answering and the problem is inside it.

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

### Validating your configuration before you boot

Assembling 50 channel account secrets and a sponsor key by hand is easy to get subtly wrong, and the failure shows up as a confusing settlement error rather than a clear configuration error. The SDK ships a setup aid you can call from a local integration test setup script or a pre-boot check:

```js
import { validateChannelAccountSecretKeys } from "@vellar/x402";

// Throws with a clear message if the configuration is invalid.
validateChannelAccountSecretKeys(
  process.env.CHANNEL_ACCOUNT_SECRET_KEYS,
  process.env.SPONSOR_SECRET_KEY,
);
```

`validateChannelAccountSecretKeys(channelAccountSecretKeys, sponsorSecretKey)` checks that:

- the value contains **exactly 50** comma-separated entries;
- every entry is a well-formed Stellar classic secret key (validated with the SDK's existing address-validation helpers);
- the sponsor secret key does **not** appear anywhere in the channel account set.

> ⚠️ **The sponsor key must never be in the channel account set.** It is an easy mistake to make when copy-pasting environment variables for a local or test facilitator: the sponsor key ends up duplicated into `CHANNEL_ACCOUNT_SECRET_KEYS`, and the instance silently misconfigures itself. The helper fails clearly when it detects this, so run it before you boot rather than debugging a settlement failure later.

### Monitoring your own instance

Two more helpers help you keep a self-hosted facilitator healthy. Both are documented in full, with their defaults and semantics, in [Fees and sponsorship](../reference/fees.md):

- **Sponsor balance classifier** — given the current sponsor balance and the soft/hard floor values, classifies the balance as healthy, soft-floor-warning, or hard-floor-refused, so you get a warning before an outright `settlement_refused` with `sponsor_balance_low`. Defaults to `SPONSOR_SOFT_FLOOR_STROOPS` (250,000,000) and `SPONSOR_HARD_FLOOR_STROOPS` (100,000,000), and accepts overrides for a custom configuration.
- **Rolling spend window** — a client-side accounting helper mirroring `SPEND_CEILING_STROOPS` (default 50,000,000) and `SPEND_WINDOW_MS` (default 60,000) for local estimation. It is an estimation aid only and is **not** a substitute for the facilitator's own server-side enforcement.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| A request times out or cannot connect | The facilitator or network is unavailable | Check service and network availability; the hosted instance does not require a cold-start wait |
| `/settle` returns an empty `transaction` field with `settle_exact_stellar_transaction_submission_failed` or `settle_exact_stellar_transaction_failed` | The transaction was never submitted, so nothing was spent | Sign a fresh payload and retry once. A retry cannot double-pay. Do not retry if `transaction` is non-empty |
| `settlement_refused` with `sponsor_balance_low` | The sponsor account is below `SPONSOR_HARD_FLOOR_STROOPS` (default 100,000,000 stroops, 10 XLM) | Wait for the operator to refund the sponsor, or fund your own sponsor if you run the instance |
| `400 verified_only_unavailable` | You filtered discovery on `verified_only=true` and there is no verdict source | Use `ownerVerified` instead |
| `curl -I` returns a plain `200` on a paid route | HEAD carries no payment challenge, so a correctly wired route looks broken | Debug with `GET`, never `HEAD` |
| Catalog is empty after a restart | The hosted instance has no persistent disk, so the catalog resets on restart | Nothing to fix. A resource re-catalogs after its next settled payment. Set `CATALOG_DB_URL` on your own instance for durable storage |

## Next steps

- [Run your own facilitator](./run.md)
- [Configuration reference](./configuration.md)
- [Fees and sponsorship](../reference/fees.md)
- [Bazaar and discovery](../concepts/bazaar-and-discovery.md)
