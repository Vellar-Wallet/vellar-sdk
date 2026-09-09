# Run the Facilitator

> Run your own Vellar facilitator locally in under five minutes, with a persistent catalog and a channel-account pool for concurrent settlement.

By the end of this page you will have a facilitator running on your own machine,
verified with `/health` and `/supported`, and a real test payment settled through
it by a seller and a buyer you also run locally.

Running your own instance is the right move for local development. The hosted
instance at `https://vellar-facilitator.onrender.com` shares a global catalog, so
a `localhost` seller URL pointed at it leaves a permanent, unremovable entry that
can never be verified (verification is https only, no loopback). Your own
facilitator keeps that mess local, and with `CATALOG_DB_URL` set it keeps the
catalog across restarts.

## Prerequisites

- Node 20 or later
- `npm install` in the repo root and in `examples/`
- A funded testnet sponsor account. Fund any keypair at
  [friendbot.stellar.org](https://friendbot.stellar.org)
- Exactly 50 funded channel accounts, one Stellar classic (`S...`) secret each

> ⚠️ **`CHANNEL_ACCOUNT_SECRET_KEYS` must contain exactly 50 keys.** Not 49, not
> 51. There is no default and no fallback. A smaller pool loses the
> collision-free guarantee for 50 concurrent settlements, so the count is
> enforced at boot rather than at the first collision. Step 2 on this page
> covers generating and funding the pool.

## 1. Provision accounts and assets

Clone the repo, install the example dependencies, and let the provisioning
script create everything the loop needs.

```bash
git clone https://github.com/Vellar-Wallet/vellar-facilitator
cd vellar-facilitator/examples
npm install
node provision-testnet.mjs

# Or use canonical testnet USDC instead of a throwaway minted token:
# USE_USDC=1 node provision-testnet.mjs
```

`provision-testnet.mjs` creates an issuer, a Stellar Asset Contract, a merchant
account with a trustline, and a funded payer, then prints a paste-ready env
block. Keep that block: the next three steps read values out of it.

With `USE_USDC=1` the script uses canonical testnet USDC rather than minting a
throwaway token.

## 2. Provision the channel pool

The facilitator requires exactly 50 funded channel accounts. Generate them:

> **Note:** Run this from the repo root or from `examples/`, where
> `@stellar/stellar-sdk` is installed. The script fails with
> `MODULE_NOT_FOUND` if you run it from an empty directory.

```bash
node -e "
const { Keypair } = require('@stellar/stellar-sdk');
const keys = Array.from({ length: 50 }, () => Keypair.random());
// The value for CHANNEL_ACCOUNT_SECRET_KEYS, written with export so that
// sourcing the file puts it in the environment npm start actually reads:
console.log('export CHANNEL_ACCOUNT_SECRET_KEYS=' + keys.map(k => k.secret()).join(','));
// The public keys, which is what friendbot funds:
keys.forEach((k, i) => console.error('Account ' + (i + 1) + ' ' + k.publicKey()));
" > channel-keys.env
```

The secrets go to `channel-keys.env`; the public keys print to stderr so you can
see what to fund. Fund every one of them through friendbot:

```bash
node -e "
const { Keypair } = require('@stellar/stellar-sdk');
const line = require('fs').readFileSync('channel-keys.env', 'utf8').trim();
line.replace(/^export CHANNEL_ACCOUNT_SECRET_KEYS=/, '').split(',')
  .forEach(s => console.log(Keypair.fromSecret(s).publicKey()));
" | while IFS= read -r pubkey; do
  curl -s "https://friendbot.stellar.org?addr=$pubkey" > /dev/null
  echo "Funded: $pubkey"
done
```

Or fund each public key individually at friendbot.stellar.org.

> ⚠️ **`channel-keys.env` holds 50 Stellar secrets.** Treat it as a credential
> file. Do not commit it, and add it to `.gitignore` before you do anything
> else.

Load the env block before starting the facilitator:

```bash
source channel-keys.env
```

> **Note:** If `source` does not export the variable in your shell, use
> `set -a; source channel-keys.env; set +a` instead. Without the export,
> `CHANNEL_ACCOUNT_SECRET_KEYS` is only a shell variable and `npm start` never
> sees it, so the facilitator fails its boot check as though you had not set it
> at all.

> **Note:** This script is a development convenience for testnet. For a
> production deployment, generate the keys in a secure environment, store them
> in a secrets manager, and fund the accounts on pubnet with real XLM.

## 3. Start the facilitator

> ⚠️ **libSQL will not create the data directory for you.** Without it the
> facilitator fails with `ConnectionFailed("./data/catalog.db: 14")`, where 14 is
> `SQLITE_CANTOPEN`. Run `mkdir -p data` first. The error names the file, not the
> missing directory, so it reads like a corrupt database when it is not.

```bash
mkdir -p data

SPONSOR_SECRET_KEY=S... \
CHANNEL_ACCOUNT_SECRET_KEYS=S...,S...,... \
PORT=4100 \
CATALOG_DB_URL=file:./data/catalog.db \
npm start
```

`SPONSOR_SECRET_KEY` is a funded Stellar classic (`S...`) secret. It settles
payments and pays the sponsored fees. Never include it in
`CHANNEL_ACCOUNT_SECRET_KEYS`: the boot check rejects that outright.

`CHANNEL_ACCOUNT_SECRET_KEYS` is exactly 50 comma-separated Stellar classic
(`S...`) secrets, one per channel account. Step 2 on this page covers generating
and funding the pool.

> **Note:** `CATALOG_DB_URL` is unset by default, which means the catalog lives
> in memory and nothing survives a restart. `file:./data/catalog.db` is the local
> choice; a `libsql://...` URL points at Turso for production, in which case you
> also need `CATALOG_DB_AUTH_TOKEN`.

`PORT` defaults to 4100 and `HOST` defaults to `0.0.0.0`, so `PORT=4100` above is
explicit rather than required. `STELLAR_NETWORK` defaults to `testnet` and
accepts only `"testnet"` or `"pubnet"`: `"mainnet"`, `"PUBNET"` and
`"stellar:pubnet"` all fail the boot rather than silently defaulting.

## 4. Verify it started

```bash
curl localhost:4100/health
curl localhost:4100/supported
```

`/health` should report `status: "ok"`. `/supported` should list schemes
including `stellar:testnet` `exact` with `areFeesSponsored: true`, and extensions
including `bazaar`.

Four other `/health` fields are worth reading now so they mean something later:

| Field | What it tells you |
| --- | --- |
| `catalogSize` | Number of entries currently in the catalog |
| `reverifyPending` | Ownership re-verification checks in flight after a restart. `0` means the catalog's trust state is settled |
| `unverifiableEntries` | Count of entries whose URLs can structurally never be verified (http, loopback, route template) |
| `channelPool.available` | Channel accounts available for settlement. `50` means the pool is fully healthy |

> **Note:** `unverifiableEntries` is absent when zero, not `0`. A healthy catalog
> does not carry the key at all, so check for the key's presence rather than its
> value. A non-zero count means a permanent problem with those entries, not a
> transient one.

`/health` also reports `commit`, the git commit hash currently serving.

## 5. Run a seller

From `examples/`, start a seller pointed at your local facilitator, using the
`PAYTO` and `ASSET` values the provisioning script printed.

```bash
cd examples

FACILITATOR_URL=http://localhost:4100 \
PAYTO=G... \
ASSET=C... \
PRICE_ATOMIC=1000000 \
node seller.mjs
```

> **Note:** `seller.mjs` refuses to boot if `PAYTO` has no trustline to `ASSET`.
> That check exists because without it a payment verifies successfully and then
> fails at settlement with an on-chain error that reads like a spend control
> refusing it.

## 6. Run a buyer

The classic keypair path is the simplest way to prove the loop works. It needs
nothing but a funded payer secret.

```bash
RESOURCE_URL=http://127.0.0.1:4031/quote \
PAYER_SECRET=S... \
node buyer-classic.mjs
```

The smart-account path pays from a Vellar smart account with an agent session
key, which is the flow that exercises policy-governed payments.

```bash
RESOURCE_URL=http://127.0.0.1:4031/quote \
WALLET_CONTRACT_ID=C... \
AGENT_SECRET=S... \
SIM_SOURCE_ACCOUNT=G... \
node buyer.mjs
```

> ⚠️ **`SIM_SOURCE_ACCOUNT` must be a different account from the payer.**
> Simulating from the payer yields source-account credentials, which the `exact`
> scheme rejects with
> `invalid_exact_stellar_payload_unsupported_credential_type`. Use any other
> funded account as the simulation source. See
> [The payment loop](../concepts/payment-loop.md) for why simulation source and
> payer are separate roles.

> **Note:** Expect to retry. Roughly one settle in three fails on testnet with an
> empty `transaction` field. An empty `transaction` means the transaction was
> never submitted, nothing was spent, and a retry cannot double-pay. Sign a fresh
> payload and retry once. A non-empty `transaction` field means the opposite:
> fees were charged and the settlement failed on-chain after submission, so do
> not retry that one. The facilitator already retries internally (two attempts, 6
> seconds apart) before returning the error, so what you receive is after those
> retries.

## 7. Check the catalog

After one settled payment, the resource is cataloged. Cataloging happens on
settle, not on verify.

```bash
curl "localhost:4100/discovery/resources"
curl "localhost:4100/discovery/search?query=motivational+quote"
```

Your seller's URL should appear in both. If it does not, confirm the payment
actually settled rather than only verified.

> **Note:** Do not filter with `verified_only=true`. It returns
> `400 verified_only_unavailable`. Note also that without `VERIFICATION_API_URL`
> set, every verification verdict is `"unknown"`. Use `ownerVerified` instead,
> which the facilitator computes itself.

Debugging a paid route that looks unwired? Use `GET`, never `HEAD`. `curl -I`
returns a plain `200` because `HEAD` carries no payment challenge.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `ConnectionFailed("./data/catalog.db: 14")` at boot | 14 is `SQLITE_CANTOPEN`. libSQL does not create the data directory | Run `mkdir -p data` in the repo root before `npm start` |
| Boot fails with `CHANNEL_ACCOUNT_SECRET_KEYS is required` | The variable is not set. There is no default and no fallback | Set it to exactly 50 comma-separated `S...` secrets. See [Configuration](./configuration.md) |
| Boot fails with `must contain exactly 50 keys, got N` | The pool has the wrong count. A smaller pool loses the collision-free guarantee for 50 concurrent settlements | Supply exactly 50 keys, not 49 and not 51. The count is enforced at boot, not at the first collision |
| Boot fails with `contains SPONSOR_SECRET_KEY` | The sponsor secret appears in the channel key list | Remove it. The sponsor settles payments and pays sponsored fees, and must never double as a channel account |
| `seller.mjs` refuses to boot | `PAYTO` has no trustline to `ASSET` | Add the trustline before starting. The check is deliberate: without it, payments verify and then fail at settlement with an error that reads like a spend control refusal |
| `buyer.mjs` fails with `invalid_exact_stellar_payload_unsupported_credential_type` | `SIM_SOURCE_ACCOUNT` is the same account as the payer, so simulation produced source-account credentials | Point `SIM_SOURCE_ACCOUNT` at a different funded account |
| `/settle` returns an empty `transaction` field | The transaction was never submitted. Nothing was spent | Sign a fresh payload and retry once. The facilitator already retried twice, 6 seconds apart, before returning this |
| `400 verified_only_unavailable` on a discovery query | You filtered on `verified_only=true`, which the discovery API does not support | Filter on `ownerVerified` instead |

## Next steps

- [Configuration](./configuration.md)
- [Limits](./limits.md)
- [Charge for an endpoint](../sellers/charge-for-an-endpoint.md)
- [Fees](../reference/fees.md)
