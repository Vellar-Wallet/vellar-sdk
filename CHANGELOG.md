# Changelog

## 0.6.1 — 2026-08-24

Developer-experience patch ahead of the hackathon. Everything is additive; no
public API was removed or changed in shape. Three first-hour failure modes now
fail fast with actionable errors instead of raw stack traces:

- **`passkey-kit` is declared as an optional peer dependency** (`>=0.13.0
  <0.17.0`, the range the structural `PasskeyKitLike` seam is written against).
  The SDK still never imports it — hosts construct the real `PasskeyKit` and
  pass it in — but package managers now surface the relationship instead of the
  Quick Start's `import { PasskeyKit } from "passkey-kit"` failing with a bare
  `Cannot find module`.

- **A missing or malformed x402 `rpcUrl` now throws `X402NotConfiguredError` at
  `createVellarWallet` construction** (and defensively on every
  `createX402Client` call), naming the field and giving the testnet example
  value. Previously an empty `rpcUrl` slipped through and `wallet.x402.fetch()`
  later failed deep inside `@stellar/stellar-sdk` with a raw
  `TypeError: Invalid URL`. New export: `assertValidX402RpcUrl`.

- **Passkey ceremonies outside a browser now throw
  `PasskeyBrowserRequiredError` before any WebAuthn call.** `vellar.create()` /
  `vellar.connect()` in a Node script used to die inside the kit with a raw
  `WebAuthnError`; the new error explains that WebAuthn needs a browser and
  points headless/CLI/agent users at the session-key path
  (`wallet.agents.mint` + `createSessionKeySigner` + `wallet.x402`). The check
  runs per ceremony, so SSR apps can still construct the client server-side.

## 0.6.0 — 2026-08-15

**If you are on 0.5.0, upgrade.** It contains a Critical vulnerability: the client
signed a Soroban authorization entry after checking only that the credential
address was ours, never checking what the entry actually *did*. A compromised or
hostile Soroban RPC could return an entry that moved a different amount to a
different recipient, and it would have been signed. The on-chain spending-limit
policy does not close this — it validates the token and the amount, and has no
opinion on the recipient. Full detail, including the threat model and what could
not be broken, is in [`docs/security-audit.md`](docs/security-audit.md).

This release fixes that and twelve other findings from the same audit.

---

### Behavioural changes

Two changes alter what an existing caller sees. Everything else in this release is
additive.

#### 1. Auth entries are now validated before signing (V-1, Critical)

`x402Client` now checks every authorization entry against the payment it is
supposed to be making — contract, function name, argument count, `from`, `to`,
`amount`, and that there are no sub-invocations — before handing it to the signer.
A mismatch throws `AuthEntryMismatchError`, which carries `field`, `expected`, and
`actual`.

**What you'll see:** a caller whose RPC returns a mismatched invocation now gets a
refusal where they previously got a signature. That is the fix working. This
announces itself clearly: named error, named field, obvious cause.

`assertAuthEntryInvocation` is exported if you want to apply the same check
yourself.

#### 2. Seller-requested signature lifetime is now capped at 300s (V-7)

**This one does not announce itself.** Read it even if the rest looks routine.

`maxTimeoutSeconds` arrives in the seller's 402 challenge, so it is
attacker-controlled. In 0.5.0 it had a floor but no ceiling unless you passed
`expirationLedgerOffset`:

```js
// 0.5.0 — no ceiling when the caller passed nothing
if (ceiling !== undefined) offset = Math.min(offset, ceiling);

// 0.6.0 — an explicit ceiling still wins; absent one, a default bound applies
offset = Math.min(offset, ceiling ?? DEFAULT_MAX_EXPIRATION_LEDGERS); // 58
```

**When it bites.** Only when a seller advertises `maxTimeoutSeconds` **above
300s**. At or below that, 0.5.0 and 0.6.0 derive an identical expiry — the x402
default of 120s yields an offset of 22 ledgers, nowhere near the 58-ledger cap.
If you pay such a seller, your signature is now valid for ~5 minutes instead of
the window they asked for, and an over-long settlement fails at settlement rather
than with a clear error. That is the failure mode worth knowing about in advance.

**The escape hatch.** `expirationLedgerOffset` on the client is still honoured
exactly as before and overrides the default — pass it if you genuinely need a
longer window.

**Why the cap exists, and why 300s.** A signature must survive exactly one
attempt, because every retry re-signs. Measured against a live facilitator, the
worst sign-to-settled window was **12.0s** (~3 ledgers), typical 8s. 300s is about
**25× that worst case**, so no legitimate settlement is affected. Needing more
than 300s means something other than the cap is wrong. On the other side, a seller
advertising 86,400 previously bought a signature valid for ~17,000 ledgers, and
anyone who obtained that payload could choose when it settled. That exposure drops
from 24 hours to 5 minutes — roughly 288× less.

---

### New surface

#### `vellar-sdk/x402-untrusted` — the fence

The thing you would not otherwise know to look for. Resource metadata from a
seller — descriptions, names, any text arriving in a 402 challenge — is untrusted
input that reaches a model's context. This module wraps it so it cannot act as
instructions:

- a nonce-delimited fence (128-bit nonce, per-render) whose terminator is never
  reproduced inside the block;
- lookalike `BEGIN`/`END UNTRUSTED RESOURCE DATA` markers stripped, including
  ones padded with dashes, equals signs, tildes, or hashes;
- control and format characters removed, newlines and line separators
  (`U+2028`/`U+2029` included) flattened;
- a 256-character bound.

If you put seller-supplied text anywhere near a model, use it.
`vellar-sdk/x402-untrusted-vectors` exports the 13 conformance vectors so an
independent implementation can be checked against the same behaviour.

#### `vellar-sdk/x402-guards` — the decision layer

Pure functions, no `stellar-sdk` dependency: `selectRequirements`,
`decodePaymentRequired`, `parseAmount` (strict, `/^\d+$/`), `decodeSettleResponseHeader`,
`isRetryableSettleFailure`, and `classifySettlement`.

`classifySettlement` returns three states — `settled`, `not-spent`,
`indeterminate` — rather than a boolean. The distinction is not cosmetic: treating
an unparseable settlement response as "not settled" and retrying is a double-spend
when the payment actually went through. `indeterminate` is never retried.

#### Additions that cannot break anything

- `assertAuthEntryInvocation`, `AuthEntryMismatchError`, `ExpectedInvocation`,
  `classifySettlement`, `SettlementOutcome`, `isRetryableSettleFailure`,
  `parseAmount`, `decodeSettleResponseHeader`, `decodeSettlementHeader`,
  `extractRejectionReason`, `base64ToUtf8`, `utf8ToBase64`, `CAIP2_BY_NETWORK`,
  `NETWORKS`, `SettleResult` on the root export (115 → 130 names, none removed).
- Policy errors carry `readonly retryable: boolean` (V-10). `503 attach_unconfirmed`
  is retryable — nothing was decided; `422 attach_mismatch` is not — retrying
  repeats a false claim. Transport failures (`status === 0`) are retryable.
- Session and passkey signers accept `policies`, adding `Policy` co-signer entries
  to the smart-wallet signature map. With no policies configured the emitted XDR is
  byte-identical to 0.5.0.

### Supply chain

Published from CI on a tag, with npm provenance (V-8). The workflow runs
`npm audit --audit-level=high`, typecheck, tests, and build, and refuses to publish
if the tag does not match `package.json`. Verify with `npm audit signatures` or
`npm view vellar-sdk@0.6.0 dist.attestations`.

### Not included

`@vellar/mcp-x402-payer` is in this repository but is **not published**. It depends
on `vellar-sdk` via a `file:` workspace link that would not resolve from a
registry, and is marked `private` so it cannot be published by accident.
