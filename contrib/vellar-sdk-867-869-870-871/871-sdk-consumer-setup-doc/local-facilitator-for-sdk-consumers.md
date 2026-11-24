# Local facilitator setup for SDK consumers

This page is for one job only: getting a local facilitator running so you can
develop and test against the Vellar SDK. It is deliberately narrower than the
operator documentation. If you need every configuration knob, operational
limits, or production guidance, read
[operators/configuration.md](../../../website/content/docs/operators/configuration.md)
and [operators/limits.md](../../../website/content/docs/operators/limits.md)
instead.

You do not need the hosted instance. The facilitator is open source and starts
locally in one command.

## The four variables you actually need

| Variable | SDK-development value | Why it is needed |
| --- | --- | --- |
| `PORT` | `4100` | The port your SDK client points at. Any free local port works; keep it consistent with your client config. |
| `CATALOG_DB_URL` | `file:./data/catalog.db` | Enables a libSQL-backed catalog so discovered resources survive a facilitator restart. Without it the catalog is in memory only. |
| `SPONSOR_SECRET_KEY` | a funded testnet `S...` key | Pays sponsored fees and settles payments. Never put this key in `CHANNEL_ACCOUNT_SECRET_KEYS`. |
| `CHANNEL_ACCOUNT_SECRET_KEYS` | 50 comma separated throwaway `S...` keys | The facilitator requires exactly 50 channel accounts, with no fallback. Generate fresh keys rather than reusing funded ones. |

Do not point this setup at mainnet keys. Use a funded testnet sponsor and
throwaway channel keys.

## One-command startup

The exact command comes from
[operators/limits.md](../../../website/content/docs/operators/limits.md):

```sh
git clone https://github.com/Vellar-Wallet/vellar-facilitator
cd vellar-facilitator
npm install
mkdir -p data
SPONSOR_SECRET_KEY=S... CHANNEL_ACCOUNT_SECRET_KEYS=S...,S...,... PORT=4100 CATALOG_DB_URL=file:./data/catalog.db npm start
```

`mkdir -p data` is required because libSQL does not create that directory for
you. The `data` directory is also where the durable catalog lives when
`CATALOG_DB_URL` is set.

## Generating the channel keys

Use the [fresh fixture generator](../870-channel-account-fixture/README.md)
shipped with the SDK examples:

```sh
export CHANNEL_ACCOUNT_SECRET_KEYS="$(node contrib/vellar-sdk-867-869-870-871/870-channel-account-fixture/channel-account-keys.mjs)"
```

Every run produces 50 new keys and prints them in the exact format the
facilitator validates. Nothing is committed to the repository.

## Pointing the SDK at it

Set the client's facilitator URL to `http://127.0.0.1:4100` and use testnet for
the RPC network. The opt-in integration test in
[869-local-facilitator-integration](../869-local-facilitator-integration/README.md)
shows a complete quote-and-pay flow with all required environment variables.
Its preflight refuses non-local endpoints because the first settlement for a
resource URL writes a permanent public catalog entry.

## Common setup failures

- `CHANNEL_ACCOUNT_SECRET_KEYS is required`: the variable is unset, or it has
  fewer or more than 50 comma separated secrets.
- `Cannot open catalog database`: `data` was not created before startup.
- Connection refused from the SDK: the `PORT` in the client config does not
  match the facilitator's `PORT`.
- Resources disappear after a restart: `CATALOG_DB_URL` was omitted, so the
  catalog was in memory only. A client cannot read this setting directly; it
  can only infer durability from observed `statsSource` values.

## Maintainer follow-up for full site integration

This page is a contrib reference document because external contributor PRs may
only change `contrib/`. To publish it as a normal docs page, a maintainer needs
to move it under `website/content/docs/getting-started/`, add inbound links
from the getting-started pages and from
`website/content/docs/operators/{limits,configuration}.md`, and register the
slug in `website/lib/docs-registry.ts`. This repository has no `meta.json`
files, so that registry is the navigation source.
