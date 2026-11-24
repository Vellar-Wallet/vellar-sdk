# Fresh channel account key fixture (#870)

`channel-account-keys.mjs` generates exactly 50 newly created Stellar classic
keypairs and prints them in the comma separated `CHANNEL_ACCOUNT_SECRET_KEYS`
format. It is a prerequisite setup step for the local facilitator integration
test in [../869-local-facilitator-integration](../869-local-facilitator-integration/README.md).

```sh
# Print to stdout and export in your shell
export CHANNEL_ACCOUNT_SECRET_KEYS="$(node contrib/vellar-sdk-867-869-870-871/870-channel-account-fixture/channel-account-keys.mjs)"

# Or write once to a private file
node contrib/vellar-sdk-867-869-870-871/870-channel-account-fixture/channel-account-keys.mjs --out /tmp/local-facilitator-keys.txt
```

Safety properties:

- `Keypair.random()` is called afresh on every invocation, so no key is reused
  between runs.
- No key fixture is committed to this repository.
- Without `--out` nothing is written to disk.
- With `--out`, the file is created with mode 0600 and the `wx` flag, so an
  existing file is never overwritten.
- `validator.ts` checks exactly 50 entries, valid StrKey secrets, and no
  duplicates. The test asserts generator output always passes it.

The sponsor key is a separate variable and must not appear in this list. Fund
only the throwaway testnet keys you need for your local run, and never use a
funded mainnet key here.

## Maintainer follow-up

Reference this generator as a setup step in `CONTRIBUTING.md` beside the
existing facilitator integration testing section.

## Verification

```sh
npx vitest run contrib/vellar-sdk-867-869-870-871/870-channel-account-fixture
```
