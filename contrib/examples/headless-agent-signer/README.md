# Headless agent signer

Constructs a `createSessionKeySigner` from a **freshly generated** ed25519
keypair and uses it to sign a hand-built sample x402 auth entry — entirely
headless: no browser, no passkey, no external input.

This is the **agent** x402 signing path (as opposed to the human passkey path).
An ed25519 session key the agent holds signs each V1
(`sorobanCredentialsAddress`) auth entry directly, producing the smart-wallet
signature map a Vellar wallet's `__check_auth` accepts. The key's spending
authority would be bounded on-chain by the spending-limit policy attached to it.

It uses the SDK's real exports:
[`createSessionKeySigner`](../../../src/x402-signer.ts),
[`SmartAccountX402Signer`](../../../src/x402-types.ts), and `TESTNET` (for the
network passphrase).

> **Testnet only.** The keypair is generated fresh on every run and holds no
> funds. Never fund it or reuse the secret for anything real.

## Flow

1. Generate a fresh ed25519 session keypair (`Keypair.random()`).
2. Pick the smart-account wallet C-address the key signs for.
3. Build the headless signer around the raw secret via `createSessionKeySigner`.
4. Hand-build a minimal V1 auth entry (a dummy SEP-41 `transfer`) and sign it
   with `signer.signAuthEntry(...)`, passing the testnet passphrase and an
   expiration ledger.

The result is inspected to confirm the credentials stayed **V1** (hosted x402
facilitators reject V2), that the embedded signer key matches the generated
public key, and that the signature is 64 bytes.

## Run it

```sh
npx tsx headless-agent-signer.ts
```

```
Headless agent signer (TESTNET ONLY — disposable key)

1. Generated session key : GB...
2. Smart-account wallet   : CA...
3. Built + signed a sample V1 auth entry (expiration ledger 1000)
4. Credentials kept V1    : true
   Signature expiration   : 1000
   Signer key matches      : true
   Signature length (bytes): 64
5. Signed entry XDR length: 288 chars

WARNING: the session key above is disposable — do not fund or reuse it.
```

## Tests

The test decodes the signed entry and additionally **cryptographically
verifies** the ed25519 signature against the recomputed auth payload, proving
the headless signer produced a valid signature:

```sh
npx vitest run contrib/examples/headless-agent-signer
```
