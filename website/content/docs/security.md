# Security

This covers the **wallet and SDK** security model. The payment layer adds its
own on-chain guarantees: spending and verified-only policies enforced inside
`__check_auth` (see [policies & provenance](./agent-tooling/policies.md)), so a compromised
agent key can't spend past its per-window cap or pay unverified code even if
the client is fully compromised. (The cap is a fixed-window guardrail — see
[Honesty](./reference/honesty.md) for its exact bound.)

The SDK is designed so the secure default is the *only* path. The guarantees:

## No private-key custody

The SDK never holds, imports, or exports a private key.

- The wallet is controlled by a **passkey** — the private key lives in the
  device's secure enclave and never leaves it.
- Your **backend** holds submission credentials (relayer/sponsor), not signing
  keys — it can submit signed transactions but can never produce a signature.
- There is no seed phrase and no key-import path.

## No silent signing

Every signature requires an explicit WebAuthn prompt. `pay()` resolves only
after the user approves; there is no API that signs without user interaction.

## Simulate before signing

`pay()` builds and **simulates** the transaction before the passkey prompt, so
failures (insufficient balance, bad recipient) surface without asking the user
to sign something that would fail.

## Address validation

You supply `isValidAddress`, and the SDK rejects a payment to an invalid
recipient **before** signing — a bad address never reaches the passkey.

## Secrets stay server-side

The relayer API key and any sponsor secret live on your server. The SDK only
ever sees a `backend` object with submission methods — no secret material is
passed to or held by the client.

## On-chain enforcement, not promises

Account policies (e.g. spending limits) are designed to be enforced **on-chain
by a Soroban contract**, not by client-side checks a malicious frontend could
skip.

## Current limitations

Be aware while the SDK is pre-`1.0`:

- **Testnet only.** Vellar runs on stellar:testnet only. Mainnet is gated on
  three items:
  1. A persistent-disk deployment.
  2. A funded pubnet sponsor account.
  3. A mainnet security audit of the spending-limit policy contract. The
     facilitator review is complete; the policy contract is a separate item.
- You are responsible for securing your own backend (the submission surface) —
  rate limiting, auth, and abuse protection are your app's concern.
