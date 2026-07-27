# Build an x402 payment requirements object

Constructs a sample x402 `PaymentRequirements`-style object by hand and
prints it as JSON, validating that `amount` is a plain digit string first.

## Where this shape comes from

This mirrors `PaymentRequirements` from `vellar-sdk`'s `src/x402-types.ts` —
one accepted payment option in an x402 `PAYMENT-REQUIRED` challenge (x402 v2).
`amount` is the token's base units as a decimal string (so an i128-range
amount round-trips exactly; it's never a JS `number`).

## Run it

```sh
npx tsx build-payment-requirements.ts
```

Expected output:

```json
{
  "scheme": "exact",
  "network": "stellar:testnet",
  "asset": "CUSDCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "amount": "2500000",
  "payTo": "CPAYTOSAMPLEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
}
```

## Tests

```sh
npx vitest run contrib/examples/build-payment-requirements
```
