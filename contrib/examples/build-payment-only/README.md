# Build a payment without submitting it

Builds (and simulates) a payment transaction using the real
`createPaymentClient()`, prints the built XDR, and stops — the transaction is
never signed or submitted.

## The simulate step during build

`preparePayment()` calls the SAC client's `transfer()`, which — for the real
SAC client — **builds and simulates** the transfer transaction against the
network in the same step (an `AssembledTransaction.build()`/simulate call).
Simulation failures (e.g. insufficient balance, a bad recipient) surface
right here, before any signature is ever requested. Only `confirm()` (which
this example deliberately never calls) actually signs and submits.

This example uses a mock SAC client instead of the real one, so it never
touches the network — the "built XDR" it prints is a mock string built
locally, not a real network-simulated transaction.

## Run it

```sh
npx tsx build-payment.ts <to> <amount> <tokenContractId>
```

Example:

```sh
npx tsx build-payment.ts GRECIPIENT... 10.5 CTOKENCONTRACT...
```

The sender (`from`) is a hardcoded sample address — a real app would use
`wallet.session.accountId`, not a CLI argument.

## Tests

```sh
npx vitest run contrib/examples/build-payment-only
```
