# Audit hook for x402 signer actions (#262)

Reference implementation for [issue #262](https://github.com/Vellar-Wallet/vellar-sdk/issues/262):
Define the list of signer actions requiring an audit hook and add an onSignerAction hook
invoked with actor context and outcome.

## What's here

- `audit-hook.ts` — exported types: `X402SignerAction`, `X402SignerActionEvent`,
  `X402SignerActionHook`
- `audit-hook.test.ts` — unit tests verifying the hook fires for each defined action
- `README.md` — this file

## Exported types

| Type | Description |
|------|-------------|
| `X402SignerAction` | `"authorize" \| "deny"` — the complete set of signer actions that warrant an audit hook |
| `X402SignerActionEvent` | Payload passed to the hook for every signer action, containing: `action`, `actor`, `outcome`, `networkPassphrase`, and optional `error` |
| `X402SignerActionHook` | Consumer-supplied audit sink: `(event: X402SignerActionEvent) => void \| Promise<void>` |

## How it works in the SDK

The SDK's `createSessionKeySigner` and `createPasskeyX402Signer` both accept an
`onSignerAction` config option of type `X402SignerActionHook`. When a signer
action completes (successfully or with error), the hook is invoked with an
`X402SignerActionEvent`.

## Example usage

```ts
import { X402SignerActionHook } from "vellar-sdk/contrib/audit-hook";

const auditLog: X402SignerActionHook = async (event) => {
  // Append to an append-only log, send to a monitoring service, etc.
  console.log(`Signer action: ${event.action}, outcome: ${event.outcome}, actor: ${event.actor}`);
};

const sessionSigner = createSessionKeySigner({
  address: "CAAA...",
  secretKey: "secret...",
  onSignerAction: auditLog,
});

const passkeySigner = createPasskeyX402Signer({
  address: "CAAA...",
  webAuthn: { async sign() { return assertion; } },
  onSignerAction: auditLog,
});
```

## Running the tests locally

```sh
# Run just the audit hook tests (hermetic, no network)
npx vitest run contrib/audit-hook
```