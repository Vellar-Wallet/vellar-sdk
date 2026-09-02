# mcp-x402-payer readiness check

A standalone `checkReadiness` helper that tells a consumer whether
`@vellar/mcp-x402-payer`'s environment is correctly configured, without
booting the server and without ever reading or logging the payer secret
itself.

Contributed for [issue #278](https://github.com/Vellar-Wallet/vellar-sdk/issues/278).

## Why

`packages/mcp-x402-payer`'s `loadConfig` only validates its environment
implicitly: it throws at startup if something is missing or malformed. That
is fine for the server process, but a consumer who wants to check
configuration ahead of time — a health check, a setup wizard, a CI smoke
test — has no way to ask "is this ready?" without starting the server and
catching whatever it throws.

`checkReadiness` re-derives the same validation rules as
[`packages/mcp-x402-payer/src/config.ts`](../../../packages/mcp-x402-payer/src/config.ts)
as a pure, side-effect-free function, and returns a typed result instead of
throwing.

## Usage

```ts
import { checkReadiness } from "./readiness-check";

const result = checkReadiness(process.env);

if (!result.ready) {
  for (const issue of result.issues) {
    console.error(`${issue.variable}: ${issue.message}`);
  }
  process.exit(1);
}

console.log("mcp-x402-payer is ready to start.");
```

`checkReadiness` accepts an optional environment record (defaults to
`process.env`), which makes it easy to test against synthetic environments
without touching real process state.

### Result shape

```ts
interface ReadinessIssue {
  variable: string; // the environment variable this issue is about
  message: string;  // human-readable, safe to print or log
}

interface ReadinessResult {
  ready: boolean;
  issues: ReadinessIssue[]; // empty when ready is true
}
```

### What is checked

- Exactly one of `VELLAR_X402_SECRET` / `VELLAR_X402_SECRET_FILE` is set, and
  an inline secret matches the shape of a Stellar ed25519 secret seed (`S...`).
  A file-sourced secret is **not** read or validated here — this check never
  touches secret material, matching the package's own non-negotiable rule.
- `VELLAR_X402_NETWORK`, if set, is `testnet` or `mainnet`.
- `VELLAR_X402_ASSETS` is present and every `<assetContractId>:<ceiling>`
  entry is well-formed, has a valid Soroban contract id, a positive integer
  ceiling, and no duplicate assets.
- `VELLAR_X402_WALLET`, if set, is a valid Soroban contract id.
- `VELLAR_X402_POLICIES`, if set, only names valid contract ids and is only
  set alongside `VELLAR_X402_WALLET`.
- `VELLAR_X402_MAX_RESPONSE_BYTES`, if set, is a positive integer.

## Run it

```sh
npx tsx readiness-check.ts
```

Prints a not-ready result for an empty environment, then a ready result for
a fully configured one.

## Tests

```sh
npx vitest run contrib/examples/issue-278-x402-payer-readiness-check
```

Covers both a fully ready configuration and each individual not-ready case
(missing secret, both secret forms set, malformed asset entries, a zero
ceiling, duplicate assets, an invalid wallet or policy id, policies without a
wallet, and an invalid `VELLAR_X402_MAX_RESPONSE_BYTES`), plus a check that no
issue message ever echoes a secret value.
