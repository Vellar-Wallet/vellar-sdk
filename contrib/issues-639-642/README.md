# Issues #639, #640, #641, #642

Everything here lives in `contrib/` per CONTRIBUTING.md. Where an issue asks for
a change to a file outside `contrib/`, the exact text is below for a maintainer
to apply.

Run: `npx vitest run contrib/issues-639-642`

## #639 Two `@stellar/stellar-sdk` copies

`dual-stellar-sdk.ts` loads the CommonJS build of `@stellar/stellar-sdk` next to
the ESM one the package imports. The two share no classes, as with two installs.
Measured against `@stellar/stellar-sdk@16.2.0`:

| Cross-instance operation | Result |
| --- | --- |
| `new B.Address(addressFromA)` | throws `Unsupported address type` |
| `B.nativeToScVal(addressFromA, { type: "address" })` | throws `cannot interpret Address value as ScVal` |
| `B.TransactionBuilder.fromXDR(transactionFromA, ...)` | throws |
| `txFromA instanceof B.Transaction` | `false` |
| `ScVal`/`ScMapEntry`/`SorobanAuthorizationEntry` mixed across copies | **no error**, serialises fine |
| strkey strings, XDR base64 strings | work, they are plain data |

Finding: vellar-sdk's public entry points take strings (XDR base64, strkeys), so
the failures above cannot be triggered through them. The silent case is raw
`xdr.*` structures, which stay valid when mixed. Class instances (`Address`,
`Transaction`) fail loudly. No runtime check is needed on the current surface.
`assertSameStellarSdkInstance(value, Ctor, label)` is provided for any future
entry point that accepts a class instance; it throws
`StellarSdkInstanceMismatchError` naming `npm ls` / `npm dedupe` / `overrides`.

Text for the README peer dependency section:

> **Two copies of `@stellar/stellar-sdk`.** `passkey-kit` brings its own
> `@stellar/stellar-sdk` range, so your tree can resolve two copies. vellar-sdk's
> public API takes XDR and strkey strings, so values cross the boundary safely.
> Passing a class instance (`Address`, `Transaction`) built by the other copy
> fails, because `instanceof` and constructor checks do not match across copies.
> Check with `npm ls @stellar/stellar-sdk` and fix with `npm dedupe` or an
> `overrides` entry.

## #640 Wasm hash pin

`wasm-hash-pin.mjs` reads the passkey-kit README and deployment manifest at the
tag of the installed version and compares the manifest's smart-wallet hash with
`TESTNET.walletWasmHash`. `verify-wasm-hash.mjs` is the CI entry point.
MAINNET is blank by design and is only checked for being blank or valid hex.

**Current result on `dev`: the check fails.** `TESTNET.walletWasmHash` is
`fdefad64...` but passkey-kit 0.16.5's manifest (`docs/deployments-2026-08-19.md`)
says `502ea4e7bdb3ea99880941f1d35ceb67fb598692c0bb40f842ef9c9f17d58b58`. The
unit tests use fixtures and do not touch the network.

To wire in: add `node contrib/issues-639-642/verify-wasm-hash.mjs` to
`.github/workflows/ci.yml` after `npm run typecheck`, and add this comment next
to `TESTNET` in `src/config.ts`:

```ts
// walletWasmHash is verified in CI by contrib/issues-639-642/verify-wasm-hash.mjs:
// it fetches the passkey-kit deployment manifest at the tag of the installed
// passkey-kit version and fails if the smart-wallet hash differs from this one.
```

## #641 passkey-kit release watch

`passkey-release-watch.mjs` compares npm's latest `passkey-kit` with the
declared peer range. Releases inside the range are silent. Outside it, one
tracking issue is created, or its title updated if a newer release appears.
`watch-passkey-release.mjs` is the CLI; it exits 1 if it cannot read the
registry or open the issue. `workflows/passkey-kit-release-watch.yml` runs it
every Monday 09:00 UTC; move it to `.github/workflows/` to enable.

**Current result on `dev`: it reports passkey-kit 0.19.1 outside `>=0.13.0 <0.17.0`.**

Text for CONTRIBUTING.md:

> **passkey-kit release watch.** A scheduled workflow
> (`passkey-kit-release-watch.yml`, Mondays 09:00 UTC) compares the latest
> published `passkey-kit` with the peer range in `package.json`. Patch releases
> inside the range are ignored. A release outside it opens, or updates, a single
> tracking issue so a breaking change does not go unnoticed.

## #642 React 19 strict mode

`react-strict-mode.ts` is a local stand-in for the future React binding (#457).
`connectOnce` shares one in-flight `wallet.connect()` per handle;
`useWalletConnect` gates state updates with a `cancelled` flag in cleanup. The
tests mount it in `React.StrictMode` and assert one `connect` call (one passkey
prompt), correct behaviour on unmount, rejection, and retry. A naive effect is
included to show the harness does detect the double call.

Effect cleanup pattern for the official binding:
1. Never call `wallet.connect()` directly in an effect; go through a
   per-handle in-flight dedupe, because strict mode discards the first pass's
   refs and state.
2. Cleanup cannot cancel a WebAuthn prompt. It only sets `cancelled` so the
   result is ignored.
3. Clear the in-flight entry on settle so a retry can connect again.

The test needs `react@19`, `react-dom@19` and `jsdom` as devDependencies. They
are not in `package.json` (outside `contrib/`), so the suite **skips** until a
maintainer adds them.

## Known baseline problems on `dev` (not caused by this change)

- `src/x402-signer.ts:231` has a syntax error from a broken merge, which fails
  many suites that import it (`src/index.exports.test.ts` among them).
- `src/tx-rpc.ts` calls `Transaction.fromXDR`, which does not exist in the
  installed `@stellar/stellar-sdk@16.2.0`.
