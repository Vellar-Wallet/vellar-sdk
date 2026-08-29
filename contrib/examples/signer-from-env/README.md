# Session-key signer from an env secret

A standalone example that reads an ed25519 secret key from an environment
variable and constructs a `createSessionKeySigner` from it, with clear error
handling when the variable is missing or malformed.

## Environment variables

- `VELLAR_SESSION_KEY_SECRET` — the ed25519 session key secret seed
  (Stellar `S…` format, 56 characters). Read by `createSessionKeySignerFromEnv`.
- `VELLAR_WALLET_ADDRESS` — the smart-account `C…` address this session key
  pays for. Read by `main()` when run as a script.

**Never commit a real secret key to source control or a `.env` file that
gets checked in.** These are example/test values only — treat any secret
that has ever touched a real wallet as compromised.

## What it does

`createSessionKeySignerFromEnv(address, envVarName?)`:

1. Reads `process.env[envVarName]` (defaults to `VELLAR_SESSION_KEY_SECRET`).
2. Throws a descriptive error if the variable is unset/empty, or if it
   doesn't look like a Stellar secret key (wrong prefix/length) — before
   ever handing it to `Keypair.fromSecret`.
3. Otherwise calls `createSessionKeySigner({ address, secretKey })` from
   `src/x402-signer.ts` and returns the resulting `SmartAccountX402Signer`.

## Run it

```sh
export VELLAR_SESSION_KEY_SECRET="S..."
export VELLAR_WALLET_ADDRESS="C..."
npx tsx contrib/examples/signer-from-env/signer-from-env.ts
```

## Test it

```sh
npm test -- contrib/examples/signer-from-env
```
