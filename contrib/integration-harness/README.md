# Integration harness for client.ts + http-backend.ts (#265)

Reference implementation for [issue #265](https://github.com/Vellar-Wallet/vellar-sdk/issues/265):
Add a test harness that wires `client.ts` to a mocked `http-backend.ts`.

## What's here

- `harness.ts` — mock backend server and harness builder
- `harness.test.ts` — unit tests covering wallet initialization, balance fetch, and payment submission
- `README.md` — this file

## How it works

The harness replaces the real gateway backend with a path-routing mock `fetch`
implementation. When `createVellarWallet` (from `client.ts`) is constructed with
`createHttpWalletBackend(API_URL, makeMockServer({ calls }))`, every outbound
HTTP request goes through the mock. The mock records each request in `calls`
and returns synthetic responses for the well-known gateway paths:

| Path | Response |
|------|----------|
| `/wallet/create` | `{ sessionId: "sess-create" }` |
| `/wallet/connect` | `{ contractId: "...", sessionId: "sess-connect" }` |
| `/wallet/submit` | `{ hash: "txhash-submit" }` |
| `/wallet/balance` | `{ contractId, balances }` |

## Running the harness locally

```sh
# Run just the harness tests (hermetic, no network)
npx vitest run contrib/integration-harness
```

To wire this into the SDK's own test pipeline (maintainer only):

1. Add the test file to `src/` or keep it in `contrib/` and reference it from
   the CI workflow.
2. The existing `src/client-backend-harness.test.ts` already exercises the same
   pattern — this contrib version is a standalone reference that contributors
   can run independently.

## Contributor notes

- This module only imports types from `src/` (erased at compile time), so it
  lives entirely inside `contrib/` per the contribution rules.
- To add a new gateway path, edit `makeMockServer` in `harness.ts` and add a
  corresponding case.