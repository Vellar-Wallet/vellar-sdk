# Local facilitator integration test (#869)

`local-facilitator.integration.test.ts` is an opt-in quote-and-pay test against
a locally running `vellar-facilitator`. It exercises the SDK x402 client, not a
mock, and it refuses any non-local endpoint.

## Prerequisites

Start the facilitator with the one-command setup documented in
[operators/limits.md](../../../website/content/docs/operators/limits.md):

```sh
git clone https://github.com/Vellar-Wallet/vellar-facilitator
cd vellar-facilitator
npm install
mkdir -p data
SPONSOR_SECRET_KEY=S... CHANNEL_ACCOUNT_SECRET_KEYS=S...,S...,... PORT=4100 CATALOG_DB_URL=file:./data/catalog.db npm start
```

Generate the 50 throwaway channel keys with
[the #870 fixture generator](../870-channel-account-fixture/README.md). Then
set all of:

```sh
export VELLAR_LOCAL_FACILITATOR_URL=http://127.0.0.1:4100
export VELLAR_X402_SELLER_URL=http://127.0.0.1:4021/paid
export VELLAR_X402_RPC_URL=https://soroban-testnet.stellar.org
export VELLAR_X402_SECRET=S...        # funded testnet classic key
export VELLAR_X402_TEST_ASSET=C...    # SAC contract id of the payment asset
```

Run it deliberately:

```sh
npx vitest run --config vitest.config.ts contrib/vellar-sdk-867-869-870-871/869-local-facilitator-integration/local-facilitator.integration.test.ts
```

Note: the repository's `vitest.config.ts` excludes `*.integration.test.ts` from
`npm test`. To run an excluded file by path, copy the config and remove that
exclude entry, or use the existing `npm run test:integration` harness that
wires up the same environment variables.

## Clean skip behavior

- No variables set: the suite is skipped at collection time.
- Partially set variables: `readLocalFacilitatorEnv` throws a message naming
  every missing variable, so a typo cannot silently disable the test.
- A non-local facilitator or seller URL throws immediately.
- A local URL with no process behind it: one 1.5 second probe returns a clear
  skip reason that names the startup docs. No confusing connection error is
  raised inside a test body.

Those four behaviors are unit-tested in `preflight.test.ts`, which runs in the
default hermetic suite.

## Known upstream blocker

The test imports the SDK x402 client, which re-exports `src/x402-guards.ts`.
That file imports two names that its dependency does not export. Vitest
tolerates the missing named export at collection time, so the clean-skip path
works today, but `npm run typecheck` and the build remain broken until a
maintainer fixes that upstream import. The preflight unit tests are unaffected
and pass today.

## Maintainer follow-up

Add these prerequisites to `CONTRIBUTING.md` under "Integration testing",
cross-linking the exact startup command from `operators/limits.md`.

## Verification

```sh
npx vitest run contrib/vellar-sdk-867-869-870-871/869-local-facilitator-integration/preflight.test.ts
```
