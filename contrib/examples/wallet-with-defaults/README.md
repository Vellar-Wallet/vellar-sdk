# Wallet with sane defaults

Wraps `createVellarWallet` with a helper, `createWalletWithDefaults()`, that
fills in `network: "testnet"`, `appName: "vellar-example"`, and an
`isValidAddress` accepting both classic (`G...`) and contract (`C...`)
addresses — so a caller only needs to supply `kit`, `backend`, and `sac`.
Any default can still be overridden by passing it explicitly.

`sac` is **not** defaulted, on purpose: there's no safe stand-in for the
real SAC client — a stub that throws breaks payments unexpectedly, and a
stub that silently succeeds would fake a payment working. Both are worse
than asking the caller for it explicitly.

## Run it

```sh
npx tsx wallet-with-defaults.ts
```

Wires a mock kit/backend/sac into `createWalletWithDefaults()` and calls
`create()`, printing the resulting session.

## Tests

Shows the helper producing a working wallet handle with a mock kit, and
that both `network` and `isValidAddress` can be overridden:

```sh
npx vitest run contrib/examples/wallet-with-defaults
```
