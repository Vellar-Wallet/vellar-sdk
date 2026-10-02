# Runtime assertions for x402 payloads (#222)

Reference implementation for [issue #222](https://github.com/Vellar-Wallet/vellar-sdk/issues/222):
`src/x402-types.ts` declares TypeScript types for the core x402 payloads
(`PaymentRequirements`, `PaymentRequired`) but performs no runtime check.
Types are erased at build time, so a malformed 402 challenge from the network
boundary can pass straight through the SDK and fail later, far from the
actual bad input.

## What's here

- `assertions.ts` — `assertPaymentRequirements`, `assertPaymentRequired`, and
  `InvalidX402PayloadError` (lists every missing/malformed field, not just
  the first one hit).
- `assertions.test.ts` — unit tests covering valid, missing-field, and
  malformed-field payloads for both assertions.

This is scoped to `contrib/` per `CONTRIBUTING.md`: it only imports *types*
(erased at compile time) from `../../src/x402-types`, and has no runtime
dependency on SDK internals. It can be used today as a standalone wrapper
around `decodePaymentRequired` / `selectRequirements` from `vellar-sdk/x402-guards`.

## Wiring this into the SDK itself

Closing #222 for real means these assertions run *inside* the SDK's own
decode path, not just as an opt-in wrapper a consumer has to know to add.
That requires editing files outside `contrib/`, which is outside a
contributor's scope — flagged on the issue for a maintainer. The change is
small:

1. Move `InvalidX402PayloadError`, `assertPaymentRequirements`, and
   `assertPaymentRequired` from `assertions.ts` into `src/x402-types.ts`
   (dropping the relative import, since they'd live next to the types they
   validate).
2. In `src/x402-guards.ts`:
   - `decodePaymentRequired`: after `JSON.parse(base64ToUtf8(header))`, call
     `assertPaymentRequired(parsed)` before returning it. Keep this loose
     (only `x402Version`/`accepts`-shape) so x402 v1 challenges still decode
     for version negotiation elsewhere (see the doc comment on
     `assertPaymentRequired` in `assertions.ts` for why).
   - `selectRequirements`: at the top, `options.forEach((a) =>
     assertPaymentRequirements(a))` to deep-validate every offered option
     once the challenge is confirmed v2-shaped.
3. Add the same test cases from `assertions.test.ts` to
   `src/x402-guards.test.ts`, using the project's existing fixtures
   (`src/x402-test-fixtures.ts`).

## Running the tests here

```sh
npx vitest run contrib/x402-payload-assertions
```
