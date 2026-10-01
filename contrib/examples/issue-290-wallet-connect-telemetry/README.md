# Wallet connect funnel telemetry schema

A telemetry event schema for the wallet connect funnel, plus
`withConnectTelemetry` — a decorator that wraps any `WalletConnector`
(`src/connector.ts`) and emits those events around `connectWallet()`.

Contributed for [issue #290](https://github.com/Vellar-Wallet/vellar-sdk/issues/290).

## Why a wrapper instead of editing `connector.ts`

The issue asks for "optional event emission hooks at each step in
connector.ts". Contributor PRs may only touch files under `contrib/` (see
[CONTRIBUTING.md](../../../CONTRIBUTING.md) and
[contrib/README.md](../../README.md)), so this ships the schema and the hook
points as a decorator around the existing `WalletConnector` interface
instead. A maintainer merging this can lift the emission points directly
into `connectWallet` in
[`src/passkeykit-connector.ts`](../../../src/passkeykit-connector.ts) —
firing `options.onConnectEvent(...)` at each numbered step — which is
strictly more precise than this wrapper, since the wrapper can only observe
the ceremony and backend lookup as one opaque call from the outside (see the
comment in `connect-telemetry.ts` at the `connectWallet` call site).

## The funnel

Events fire in this order for every `connectWallet()` call, always ending in
exactly one of the last two:

1. `connect_started` — the call began.
2. `connect_webauthn_ceremony_started` — the passkey (WebAuthn) ceremony is
   about to run.
3. `connect_webauthn_ceremony_completed` — the ceremony resolved a
   credential. Carries `keyId` (the public credential id — never anything
   secret).
4. `connect_backend_lookup_started` — resolving the credential to a wallet's
   contract id via the backend (`WalletBackend.lookupContractId`).
5. `connect_backend_lookup_completed` — carries `found: boolean`.
6. `connect_session_key_rotated` — part of the schema for when session key
   rotation (#223) is configured and runs. This wrapper cannot observe
   rotation from outside `connectWallet`, so it never emits this one itself;
   a maintainer lifting these hooks into `passkeykit-connector.ts` directly
   would fire it from `rotateSessionKey`.
7. `connect_succeeded` — carries `accountId` and `durationMs`. **or**
   `connect_failed` — carries `failedAtStep`, `errorName`, `errorMessage`,
   and `durationMs`.

Every event carries `timestamp`, `connectionAttemptId` (stable across all
events from one call, so a backend can group and reconstruct one funnel run),
and `network`.

None of these events, at any step, carry a secret, a signature, or private
key material — only public identifiers (`keyId`, `accountId`) and outcome
metadata.

## Usage

```ts
import { withConnectTelemetry } from "./connect-telemetry";
import { createPasskeyKitConnector } from "vellar-sdk";

const baseConnector = createPasskeyKitConnector({ kit, backend, network, appName });

const connector = withConnectTelemetry(baseConnector, (event) => {
  analytics.track(event.name, event);
});

// connector behaves exactly like baseConnector, but connectWallet() now
// also emits the funnel above through the hook.
await connector.connectWallet("testnet");
```

The hook is synchronous and best-effort: if it throws, the error is swallowed
and the underlying connect call is unaffected — telemetry must never be able
to break wallet connection.

## Run it

```sh
npx tsx connect-telemetry.ts
```

Runs a mock connector through `withConnectTelemetry` and prints the emitted
event sequence and full event payloads.

## Tests

```sh
npx vitest run contrib/examples/issue-290-wallet-connect-telemetry
```

Verifies the full event order on success, that all events from one call share
a `connectionAttemptId` and the requested `network`, that `connect_succeeded`
carries the account id and a duration, that `connect_webauthn_ceremony_completed`
carries the resolved `keyId`, that a thrown error produces `connect_failed`
with the right `errorName`/`errorMessage`/`failedAtStep`, that a throwing
telemetry hook never breaks the underlying connect call, that `createWallet`
and `signTransaction` are left uninstrumented, and that concurrent calls get
distinct `connectionAttemptId`s.
