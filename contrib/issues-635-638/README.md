# Issues #635, #636, #637, #638

Contributor PRs may only touch `contrib/`, so everything lives here with
integration notes for maintainers. Tests run in the normal `npm test`.

Note: the issue texts quote stale ranges (stellar-sdk `^17.2.1`, passkey-kit
`^0.19.1`). Everything here is derived from the ranges `package.json` declares
today: `@stellar/stellar-sdk` `^16.0.0` and `passkey-kit` `>=0.13.0 <0.17.0`.

## #635 / #636 — peer compat matrix

- `peer-compat-matrix.yml` — workflow to copy to `.github/workflows/peer-compat.yml`.
  Matrix of `{@stellar/stellar-sdk, passkey-kit} x {floor, latest}`; each leg
  installs that version with `--no-save`, then runs typecheck + full suite, plus
  the passkey-kit connector suite. A test that passes on the default install but
  fails at the floor fails that leg.
- `resolve-compat-versions.mjs` — resolves floor/latest in-range versions from
  the npm registry using the range in `package.json`, so the matrix never drifts.
- `semver-range.mjs` — small range matcher (caret, tilde, comparators, `||`).

Versions validated by the matrix as of 2026-10-19 (re-resolved on every run):

| Peer | Declared range | Floor | Latest in range |
| --- | --- | --- | --- |
| `@stellar/stellar-sdk` | `^16.0.0` | 16.0.0 | 16.3.1 |
| `passkey-kit` | `>=0.13.0 <0.17.0` | 0.13.1 (0.13.0 was never published) | 0.16.5 |

Integration: add the README peer-dependency note with the table above.

## #637 — runtime peer-version warning

`peer-version-check.ts` exports `checkStellarSdkPeerVersion()`: logs one
actionable `console.warn` (never throws) when the resolved
`@stellar/stellar-sdk` is outside the peer range. Integration: call it at the
top of `createVellarWallet`. `@stellar/stellar-sdk` does not export a `version`
constant, so core must pass `readVersion` (e.g. from the resolved package.json);
without a version the check is silent.

## #638 — wallet without passkey-kit

`kit-optional.test.ts` covers `wallet.policies` / `wallet.agents` with no kit:
`deploy`/`simulate` fail with `WalletNotReadyError`, `deploy` without
`policyAttach` fails with `PolicyNotDeployableError`, `agents.mint` without
`agentKeys` fails with `AgentsNotConfiguredError`; `listTemplates`, `generate`
and `policies.client.simulate` work. Findings for maintainers:

- `wallet.create()` / `wallet.connect()` with no kit currently throw a raw
  `Cannot read properties of undefined` TypeError (needs a src fix).
- `wallet.policies.simulate` on the facade requires a session, so it does not
  work without a kit, contrary to the README claim; `policies.client.simulate`
  does.
