# Configuration

> Every environment variable the facilitator reads, its default, and what happens when it is wrong.

By the end of this page you will have a complete reference for every knob the
facilitator exposes, know which variables are required versus optional, and know
which misconfigurations fail the boot rather than degrading silently.

## Prerequisites

- A checkout of [Vellar-Wallet/vellar-facilitator](https://github.com/Vellar-Wallet/vellar-facilitator)
- Node 20 or later
- A funded Stellar sponsor account (fund any keypair at `friendbot.stellar.org` on testnet)

If you only want to get a local instance running, start with
[Run a facilitator](./run.md) and come back here for the details.

## 1. Required variables

Two variables have no default and no fallback. The facilitator refuses to boot
without either of them.

| Variable | Description |
| --- | --- |
| `SPONSOR_SECRET_KEY` | A funded Stellar classic (`S...`) secret. Settles payments and pays sponsored fees. Never include it in `CHANNEL_ACCOUNT_SECRET_KEYS`. |
| `CHANNEL_ACCOUNT_SECRET_KEYS` | Exactly 50 comma-separated Stellar classic (`S...`) secrets, one per channel account. No default, no fallback. |

> ⚠️ **Exactly 50 keys, not 49 and not 51.** A smaller pool loses the
> collision-free guarantee for 50 concurrent settlements. The count is enforced
> at boot, not at first collision, so a wrong count is a startup failure rather
> than a mysterious production incident later.

## 2. Network

| Variable | Default | Notes |
| --- | --- | --- |
| `STELLAR_NETWORK` | `testnet` | Only `testnet` or `pubnet`. |
| `STELLAR_RPC_URL` | per-network | Overrides the Soroban RPC endpoint. |
| `PORT` | `4100` | HTTP listen port. |
| `HOST` | `0.0.0.0` | HTTP bind address. |

`STELLAR_NETWORK` is strict. `mainnet`, `PUBNET` and `stellar:pubnet` all fail
the boot. Unrecognised values fail closed rather than silently defaulting to
testnet, so a typo cannot quietly point a production deployment at the wrong
network.

## 3. Fee ceiling

| Variable | Default | Notes |
| --- | --- | --- |
| `MAX_TX_FEE_STROOPS` | `500,000` | Ceiling on the fee bid before submission. |

`MAX_TX_FEE_STROOPS` is compared against the **bid** (`minResourceFee` plus
`BASE_FEE`), not the charge. A policy-governed payment bids about 130,000
stroops. The reference `x402.org` facilitator defaults to 50,000 and rejects
those payments with `fee_exceeds_maximum`.

> ⚠️ **Do not lower this below 200,000 if you serve smart-account buyers.**
> Policy-governed payments bid well above the reference default, and a ceiling
> refusal happens before submission, so the buyer sees a rejection rather than a
> payment. See [Fees and sponsorship](../reference/fees.md) for the measured
> numbers behind this.

## 4. Spend controls

Spend controls are **enforced on pubnet and log-only on testnet**. On testnet a
would-be refusal is logged and the settlement proceeds, so you cannot test your
handling of enforcement behaviour there.

| Variable | Default | Notes |
| --- | --- | --- |
| `SPEND_CEILING_STROOPS` | `50,000,000` (5 XLM) | Global rolling ceiling per window across all merchants. |
| `SPEND_WINDOW_MS` | `60,000` | Window length in milliseconds. |
| `SETTLE_RATE_WINDOW_MS` | `60,000` | Shared window for per-entity budgets. |
| `SETTLE_PER_URL_MAX` | `10` | Settlements per window per bound resource URL. |
| `SETTLE_PER_PAYTO_MAX` | `50` | Settlements per window per `payTo`, half of global capacity. |
| `SETTLE_UNBOUND_POOL_MAX` | `10` | Shared settlements per window for all unbound URLs. |

The four spend-control refusal reasons are `rate_limited_payto`,
`rate_limited_url`, `spend_ceiling` and `unbound_pool_exhausted`.

> **Note:** The spend ceiling is accounted at the **estimate** (500,000 stroops
> per settlement), not the actual charge (about 23,000 stroops for a keypair
> payment). So the ceiling trips after roughly 100 settlements per window while
> actually spending about 0.23 XLM of the 5 XLM it names. This is a known open
> item for pubnet tuning. It fails safe: the error is conservatism, not
> overspending.

## 5. Sponsor balance guards

| Variable | Default | Notes |
| --- | --- | --- |
| `SPONSOR_SOFT_FLOOR_STROOPS` | `250,000,000` (25 XLM) | Warns below this. |
| `SPONSOR_HARD_FLOOR_STROOPS` | `100,000,000` (10 XLM) | Refuses `/settle` below this with `settlement_refused: sponsor_balance_low`. |
| `SPONSOR_BALANCE_INTERVAL_MS` | `60,000` | How often the sponsor balance is checked. |

> ⚠️ **The hard floor must exceed `SPEND_CEILING_STROOPS`.** If it does not, the
> facilitator fails to start on pubnet. A hard floor at or below the ceiling
> would let a single window's spending carry the sponsor past the floor it is
> meant to defend.

## 6. Channel pool

| Variable | Default | Notes |
| --- | --- | --- |
| `CHANNEL_ACCOUNT_MIN_STROOPS` | `5,000,000` (5 XLM) | Reserve floor per channel account. |

Below this floor the account is pulled from the pool, and returned when it is
re-funded. `channelPool.available` in `/health` reports how many are currently
usable: 50 means the pool is fully healthy.

## 7. Catalog persistence

| Variable | Default | Notes |
| --- | --- | --- |
| `CATALOG_DB_URL` | unset (in-memory) | A libSQL URL: `file:./data/catalog.db` locally, `libsql://...` for Turso in production. |
| `CATALOG_DB_AUTH_TOKEN` | unset | Required for remote Turso. |
| `VERIFICATION_API_URL` | unset | Base URL of the Vellar verification API. |

Unset `CATALOG_DB_URL` means nothing survives a restart. Unset
`VERIFICATION_API_URL` means all verification verdicts are `"unknown"`.

> ⚠️ **libSQL will not create the data directory.** Without it you get
> `ConnectionFailed("./data/catalog.db: 14")`, which is `SQLITE_CANTOPEN`. Run
> `mkdir -p data` before starting.

```bash
mkdir -p data
CATALOG_DB_URL=file:./data/catalog.db npm start
```

## 8. Optional scheme contracts

| Variable | Default | Notes |
| --- | --- | --- |
| `UPTO_CONTRACT_ID` | unset | Set to enable the `upto` scheme. Must be a valid `C...` address or the boot fails. |
| `BOND_ESCROW_CONTRACT_ID` | unset | Set to enable bond escrow. Must be paired with `BOND_ESCROW_ADMIN_SECRET_KEY`. |
| `BOND_ESCROW_ADMIN_SECRET_KEY` | unset | Must be paired with `BOND_ESCROW_CONTRACT_ID`. |

Setting one half of the bond escrow pair without the other fails the boot rather
than starting with escrow half-configured.

> **Note:** Bond escrow is an optional feature that registers each settled
> payment with an on-chain escrow contract, giving the payer standing to
> dispute. It is not required for normal operation. Leave both `BOND_ESCROW_*`
> variables unset unless you are specifically building on the dispute and bond
> feature.

## 9. Retired variables

These are logged with a loud warning and ignored if set. They do nothing.

| Variable | Why it was retired |
| --- | --- |
| `SETTLE_RATE_MAX` | Was a second per-`payTo` budget that shadowed `SETTLE_PER_PAYTO_MAX`. Set `SETTLE_PER_PAYTO_MAX` instead. |
| `CATALOG_OWNERSHIP_BOOTSTRAP` | Durable storage removed the ambiguity it resolved. Remove it from your environment. |
| `CATALOG_FILE` | The catalog is now in libSQL. Set `CATALOG_DB_URL` instead. |

## When it fails

Every one of these stops the process at boot. None of them degrade silently.

| Error | Cause | Fix |
| --- | --- | --- |
| `SPONSOR_SECRET_KEY is required` | The variable is not set | Set it to a funded Stellar classic (`S...`) secret |
| `CHANNEL_ACCOUNT_SECRET_KEYS is required` | The variable is not set | Set it to exactly 50 comma-separated `S...` secrets |
| `must contain exactly 50 keys, got N` | Wrong number of channel keys | Provide exactly 50, not 49 and not 51 |
| `contains SPONSOR_SECRET_KEY` | The sponsor key appears in the channel list | Remove it: the sponsor is never a channel account |
| `STELLAR_NETWORK must be "pubnet" or "testnet"` | An invalid value such as `mainnet`, `PUBNET` or `stellar:pubnet` | Use exactly `testnet` or `pubnet` |
| `sponsor hard floor does not exceed spend ceiling` | `SPONSOR_HARD_FLOOR_STROOPS` is less than or equal to `SPEND_CEILING_STROOPS` | Raise the hard floor or lower the ceiling. Fatal on pubnet, a warning on testnet |
| `UPTO_CONTRACT_ID is not a valid contract address` | A malformed `C...` address | Correct the contract id, or unset it to leave the `upto` scheme disabled |
| `BOND_ESCROW_CONTRACT_ID and BOND_ESCROW_ADMIN_SECRET_KEY must be set together` | One is set without the other | Set both, or unset both |

## Next steps

- [Run a facilitator](./run.md)
- [Limits](./limits.md)
- [Fees and sponsorship](../reference/fees.md)
- [Honesty](../reference/honesty.md)
