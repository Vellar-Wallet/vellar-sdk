# Minimal seller paired with the SDK buyer flow (#875)

`seller.mjs` is a deliberately minimal x402-challenging HTTP endpoint. Its only
route, `/paid`, issues a 402 with a decodable `PAYMENT-REQUIRED` header and
serves JSON once a `PAYMENT-SIGNATURE` header is present. It is a teaching
example, not production seller infrastructure: the default verifier only checks
that a signature was supplied and marks its responses with
`x-vellar-demo-seller: unverified`. Inject a stricter `verifyPayment` function
to check with the facilitator before granting access.

Run it alone:

```sh
node contrib/vellar-sdk-873-874-875-877/875-seller-buyer-example/seller.mjs
```

## Paired buyer example

`seller-buyer.integration.test.ts` starts the seller in-process and drives the
SDK `createX402Client` against it while settling through a local facilitator.

Start the facilitator with the one-command setup from
[operators/limits.md](../../../website/content/docs/operators/limits.md), then
set:

```sh
export VELLAR_LOCAL_FACILITATOR_URL=http://127.0.0.1:4100
export VELLAR_X402_RPC_URL=https://soroban-testnet.stellar.org
export VELLAR_X402_SECRET=S...
export VELLAR_X402_TEST_ASSET=C...
```

The suite is excluded from `npm test` by the repo's `vitest.config.ts`. Run it
deliberately with a config that does not exclude `*.integration.test.ts`.
Preflight parsing, localhost enforcement, and clean-skip behavior are covered
by `preflight.test.ts`, which runs in the default hermetic suite. Seller
challenge, acceptance, and rejection paths are covered by `seller.test.ts`.

## Maintainer follow-up

Add this paired example to `CONTRIBUTING.md` under "Integration testing",
alongside the existing facilitator integration section. The contrib README
index already links it.

## Verification

```sh
npx vitest run contrib/vellar-sdk-873-874-875-877/875-seller-buyer-example
```
