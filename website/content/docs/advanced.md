# Advanced Usage

`createVelaWallet` is the paved road. For custom flows, the package also exports
the underlying building blocks it composes.

## Lower-level building blocks

```ts
import {
  createPasskeyKitConnector, // the WalletConnector (create/connect/sign)
  createPaymentClient,       // build → simulate → sign → submit
  createSessionStore,        // a session store (shared across surfaces)
  WalletNotReadyError,
} from "vellar-sdk";
```

- **`createPasskeyKitConnector(options)`** — returns a `WalletConnector` with
  `createWallet`, `connectWallet`, and `signTransaction`. Use this if you want to
  drive the wallet lifecycle yourself.
- **`createPaymentClient(options)`** — returns a `PaymentClient` whose
  `preparePayment(...)` gives you a review object and a `confirm()` you call after
  the user approves. Use this to insert your own review UI between build and sign.
- **`createSessionStore(adapter)`** — a session store with pluggable storage, for
  sharing session state across parts of your app.

The `vela.connector` and `vela.payments` getters expose the exact instances the
facade built, so you can mix the paved road with lower-level calls.

## Subpath exports

Heavier or environment-specific helpers live behind subpaths so they stay out of
bundles that don't need them:

```ts
import { formatTokenAmount, createBalanceService } from "vellar-sdk/balances";
import { createRpcBalanceReader } from "vellar-sdk/rpc"; // pulls in @stellar/stellar-sdk
```

- **`vellar-sdk/balances`** — token amount formatting and the balance service.
- **`vellar-sdk/rpc`** — RPC-backed balance readers. Imported separately so
  `@stellar/stellar-sdk` stays out of bundles that don't read balances.

## Custom review UI (example)

```ts
const prepared = await vela.payments.preparePayment({
  from: vela.session!.accountId,
  to,
  token,
  amount,
});

// show `prepared.review` in your own UI…
const { hash } = await prepared.confirm(); // signs + submits after approval
```

## TypeScript

The package ships full type declarations. Domain types (`Network`,
`WalletSession`, `CreateWalletInput`, `SignTransactionInput`) are exported from
the package root.
