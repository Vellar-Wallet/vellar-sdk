# PII redaction for consumer-supplied logging hooks

Self-contained reference for issue [#291](https://github.com/Vellar-Wallet/vellar-sdk/issues/291): redact known-sensitive fields before they reach a consumer-supplied logging hook.

## The problem

The SDK never logs anything itself, but it does hand structured `details`
objects to consumer-supplied hooks — `onDebugLog` on
`createPasskeyKitConnector` (`src/passkeykit-connector.ts`) today — that a host
typically pipes straight into their own logger or telemetry pipeline.

Those details can carry fields that identify a specific user or wallet. None
are secrets the SDK holds (it never has a wallet private key to log), but they
are stable, wallet-linkable identifiers that a log aggregator, support-ticket
export, or analytics sink generally should not retain in plaintext.

## SDK-internal fields flagged as sensitive

| Field(s) | Why |
| -------- | --- |
| `secretKey`, `secret`, `privateKey` | Key material. Reachable if a consumer's payload carries a signer config. |
| `publicKey`, `previousPublicKey`, `newPublicKey` | ed25519 session-key public keys, passed to `onDebugLog` by session-key rotation. Stable per-wallet identifier. |
| `accountId`, `contractId` | The smart-account C-address — directly identifies the wallet. |
| `keyId` | The WebAuthn credential id (`WalletSession.keyId`) — identifies the passkey/device. |
| `sessionId`, `serverSessionId` | Server-side session record ids — joins a log line back to a user's backend session. |
| `signature` | Auth-entry / WebAuthn assertion signature bytes. |

## Usage

Wrap your hook once and hand *that* to the SDK, so no call site can forget:

```ts
const connector = createPasskeyKitConnector({
  kit,
  backend,
  network: "testnet",
  appName: "Vellar",
  onDebugLog: withRedaction((event, details) => myLogger.debug(event, details)),
});
```

Or redact at the call site:

```ts
onDebugLog: (event, details) => myLogger.debug(event, redactSensitiveFields(details)),
```

Pass `extraFields` for fields specific to your own payloads:

```ts
redactSensitiveFields(details, { extraFields: ["email", "phoneNumber"] });
```

## Guidance

- **This is opt-in.** It does not change what the SDK passes to your hook —
  wiring it is your call, so existing pipelines that inspect real values are
  unaffected unless you choose to wrap.
- **Redact at the boundary, not per-field.** Wrapping the hook once with
  `withRedaction` is safer than remembering to redact at each call site.
- **It is a filter, not a serializer.** Non-plain values (`Error`, `Date`,
  class instances, XDR/`ScVal` objects) pass through untouched rather than
  being flattened into `{}`; circular references become `"[circular]"`.
- **Non-sensitive context survives**, so log lines stay useful for debugging —
  only the named fields are replaced.
- **Match is by exact field name**, case-insensitively. A field whose *value*
  happens to contain a key, under an unrecognised name, is not caught — add it
  via `extraFields`.

## Run it

```sh
npx tsx pii-redaction-logging-hooks.ts
```

## Tests

```sh
npx vitest run contrib/examples/issue-291-pii-redaction-logging-hooks
```
