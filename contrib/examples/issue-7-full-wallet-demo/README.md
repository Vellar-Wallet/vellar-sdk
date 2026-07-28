# issue-7-full-wallet-demo

Reference example (issue #7) demonstrating the **full core flow** — create,
connect, pay, and attach a spending-limit policy — through the real composed
`createVellarWallet` handle, using the `TESTNET` network config.

`full-create-connect`, `full-payment-flow`, and `full-policy-flow` each show
one piece of this in isolation; this ties all four together in one session,
the way an app actually uses the wallet.

## Flow

1. `vellar.create({ username })` — register a passkey and deploy the smart
   account.
2. Simulate a page reload (a fresh kit instance, same backend) and
   `vellar.connect()` — reconnect the same wallet.
3. `vellar.pay({ to, amount, token })` — build, simulate, sign, and submit a
   payment.
4. `policies.generate()` → `simulate()` → `deploy()` — attach a spending-limit
   policy to the wallet.

## Prerequisites this stands in for

This example is fully mocked (no live network, no WebAuthn prompt), so it
runs deterministically in CI and locally with nothing to configure. A real
integration needs, in place of the mocks here:

- **`kit`** — a real `PasskeyKit` instance. This is what actually runs the
  WebAuthn ceremony (Face ID / Touch ID / a security key) — it only works in
  a browser with a platform authenticator, which is why this reference can't
  do it live.
- **`backend`** — `createHttpWalletBackend(yourGatewayUrl)`, pointed at
  **your backend gateway**. Submission is fee-sponsored (relayer/sponsor
  secrets), so the SDK never submits directly — your server does, over the
  `/wallet/create` / `/wallet/connect` / `/wallet/submit` routes described in
  the root [README's "Your backend"](../../../README.md#your-backend)
  section. Point it at a real gateway to run this against testnet for real.
- **Policies** — `apiUrl` pointed at your policy gateway (`/policies/*`
  routes, same doc), and a `policyAttach` runtime wired to
  `kit.addPolicy(...)` (see the root README's
  [Policies](../../../README.md#policies) section) instead of the fixed mock
  hash used here.

## Run it

```sh
npx tsx index.ts
```

## Tests

```sh
npx vitest run contrib/examples/issue-7-full-wallet-demo
```

Covers the full sequence logging each step in order, `create()` and
`connect()` resolving to the same account, and the default `console.log`
logger path.
