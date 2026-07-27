# Mock WebAuthnAssertionSigner

A self-contained example implementing a mock `WebAuthnAssertionSigner` (see
`src/x402-signer.ts`) that returns a fixed, canned assertion for any payload
hash — for use in tests of the passkey x402 signer
(`createPasskeyX402Signer`).

> **The returned assertion is NOT cryptographically valid.** `MOCK_ASSERTION`
> is deterministic filler (`authenticatorData`, `clientDataJSON`, `signature`,
> and `keyId` are each a fixed, repeated byte value). It will build a
> structurally correct signed auth entry, but the "signature" bytes are not a
> real secp256r1 signature and will be rejected by any real on-chain
> `__check_auth`. Use this only to exercise code paths that consume a
> `WebAuthnAssertionSigner`, never against a real network.

## What it does

- `createMockWebAuthnAssertionSigner()` returns a `WebAuthnAssertionSigner`
  whose `sign()` always resolves to `MOCK_ASSERTION`, regardless of the
  payload hash it's given.
- `signDummyEntryWithMock()` wires that mock signer into
  `createPasskeyX402Signer` and uses it to sign a dummy V1
  (`sorobanCredentialsAddress`) auth entry, returning the signed entry XDR —
  demonstrating the full integration.

## Run it

```sh
npx tsx contrib/examples/mock-webauthn-assertion/mock-webauthn-assertion.ts
```

## Test it

```sh
npm test -- contrib/examples/mock-webauthn-assertion
```
