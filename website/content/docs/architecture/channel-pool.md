# Channel Pool

> The facilitator settles from a pool of exactly 50 dedicated channel accounts,
> the count is enforced exactly rather than as a minimum, and a monitor pulls any
> account that falls below its reserve floor.

By the end of this page you will understand why a single shared signer produces
sequence collisions under concurrent load, how a pool of dedicated accounts
removes that failure mode structurally rather than by retrying, why the count is
50 exactly and rejected otherwise, why the sponsor account is deliberately not in
the pool, and what to check when `/health` reports degraded capacity.

## The problem: sequence numbers under concurrent load

A Stellar account carries a sequence number that must increment exactly once per
submitted transaction. That is a property of the ledger, not a facilitator
choice.

If every settlement is signed and submitted from one shared source account, two
concurrent settlements both read the same base sequence number and both try to
increment from it. One wins. The other is rejected with `txBadSeq` and has to
re-sign from the new sequence number and resubmit.

Under real concurrent load this does not stay a single retry. Every retry reads a
sequence number that other in-flight settlements are also racing to consume, so
the failures cascade: retries generate more collisions, which generate more
retries.

The fix is structural rather than defensive. Give each concurrent settlement its
own source account, and there is no shared sequence state for two settlements to
contend over. There is nothing to collide on, so there is nothing to retry.

## Why exactly 50

The pool is sized for 50 truly simultaneous settlements with zero collision
probability, and the count is enforced exactly at boot.

Not 49, because a short pool does not announce itself. It behaves exactly like a
healthy pool right up until the 50th concurrent settlement, at which point the
collision-free guarantee the design rests on is simply gone, with no earlier
signal that it was ever missing.

Not 51 either, and this is the part that surprises operators: extra keys are
rejected rather than trimmed. An operator who supplies 60 keys almost certainly
believes they are buying capacity for 60 concurrent settlements. The pool is not
sized to give them that. Silently discarding the extras would leave that belief
in place and untested. Failing the boot forces the question into the open.

> ⚠️ **`CHANNEL_ACCOUNT_SECRET_KEYS` must contain exactly 50 keys.** There is no
> default and no fallback. A wrong count fails the boot with
> `must contain exactly 50 keys, got N`, which is deliberate: 49 keys instead of
> 50 would otherwise be indistinguishable from a healthy pool until the first
> collision in production.

Enforcement at boot rather than at first collision is the whole point. A
configuration error becomes a startup failure an operator sees immediately,
instead of an intermittent production incident weeks later that reproduces only
under load.

## The sponsor exclusion

The sponsor account
`GBUCR6H22CZC5OYHBJIEUS2JFZBOB63AHEGTCV6UEPMD2TMLKG2ZMIW4` is deliberately not a
member of the pool. It is reserved for exactly two jobs:

1. Funding channel accounts that fall below their reserve floor.
2. Being the fee-bump payer on every settlement transaction.

Both jobs mean the sponsor submits its own transactions, and its own transactions
consume its own sequence number. Putting it in the pool would reintroduce the
exact contention the pool exists to remove, except in the least convenient place:
a settlement colliding with the funding transaction that is meant to restore
pool capacity.

Boot fails if `CHANNEL_ACCOUNT_SECRET_KEYS` contains `SPONSOR_SECRET_KEY`, with
`contains SPONSOR_SECRET_KEY`.

This split is also what you observe on-chain. On a fee-bumped settlement the
channel account appears as `source_account` (for example
`GBG5UKF4EXHYOFQFHOO263NTZRFUSXKBRUOAPDZEKISA7CPLABH7ONV4`) and the sponsor
appears as `fee_account`. Settlements from before the channel pool show the
sponsor in both fields. On either path the buyer's address appears in neither,
and that is the non-custodial property.

## What channel accounts hold

A channel account exists to own a sequence number. That is its entire job.

It needs only enough XLM to satisfy the Stellar minimum reserve, and the default
reserve floor of 5 XLM (`CHANNEL_ACCOUNT_MIN_STROOPS`, 5,000,000 stroops) leaves
generous headroom above that.

Channel accounts never hold the payment asset, never hold buyer funds, and are
never funded beyond their reserve floor.

That is a deliberate threat-model property, not an incidental one. A compromised
channel key cannot reach buyer funds, because buyer funds never pass through a
channel account. The blast radius of one leaked channel secret is bounded by the
reserve sitting in that account. See [Threat model](./threat-model.md) for the
full accounting of what each key can and cannot do.

## The channel monitor

An account whose balance falls below `CHANNEL_ACCOUNT_MIN_STROOPS` is pulled
from the pool, so no settlement is assigned to an account that cannot pay its own
way. When the account is re-funded, it is returned to the pool. No operator action
is required beyond funding it.

The sponsor balance is checked separately, on its own interval:
`SPONSOR_BALANCE_INTERVAL_MS`, default 60,000 milliseconds.

The consequence is that capacity degrades gradually rather than failing all at
once. Losing a handful of accounts costs concurrency, not correctness.

## Checking pool health

`/health` reports `channelPool.available`, the number of channel accounts
currently usable for settlement.

```bash
curl -s https://vellar-facilitator.onrender.com/health \
  | python3 -c \
  "import json,sys; \
  d=json.load(sys.stdin); \
  print('available:', d['channelPool']['available'])"
```

Expected output on a fully healthy pool:

```
available: 50
```

50 available means every channel account is funded above its reserve floor and
idle. A lower number means accounts are either in use by an in-flight settlement
or disabled by the monitor for being below the floor. Disabled accounts are
excluded from settlement until they are re-funded.

> **Note:** `/health` is exempt from the facilitator's rate limits, so you can
> poll it. On the hosted instance the service sleeps after 15 minutes idle and
> the first request takes roughly 45 seconds, so allow 120 seconds in your
> timeout before concluding the pool is unhealthy.

A number that stays below 50 while traffic is idle points at funding, not load.
A number that dips under load and recovers is the pool working as designed.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `channelPool.available` below 50 | Accounts are in use by in-flight settlements, or the monitor disabled accounts that fell below `CHANNEL_ACCOUNT_MIN_STROOPS` | If it recovers when traffic stops, nothing is wrong. If it stays low while idle, fund the channel accounts back above the reserve floor and wait for the account to be returned to the pool |
| Boot fails with `must contain exactly 50 keys, got N` | `CHANNEL_ACCOUNT_SECRET_KEYS` has the wrong number of entries | Provide exactly 50 comma-separated `S...` secrets, not 49 and not 51. Extra keys are rejected, not trimmed |
| Boot fails with `contains SPONSOR_SECRET_KEY` | The sponsor secret appears in the channel key list | Remove it. The sponsor funds channels and pays fee bumps, and is never a channel account |
| Settlements wait on the pool under heavy concurrent load | More than 50 settlements are in flight at once, so a request waits for an account to be returned | Expected behaviour: requests queue rather than colliding. If it is sustained, check `channelPool.available` for disabled accounts before assuming the ceiling is genuine load |

## Next steps

- [The settlement path](./settlement-path.md)
- [Run a facilitator](../operators/run.md)
- [Configuration](../operators/configuration.md)
- [Threat model](./threat-model.md)
