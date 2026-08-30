# Encode a mock PAYMENT-SIGNATURE header

Encodes a JSON object describing a payment as a base64 string suitable for
an x402 `PAYMENT-SIGNATURE` request header — the same shape `vellar-sdk`'s
`buildSignedPayment` produces internally (`src/x402-client.ts`):
`{ x402Version, accepted, payload: { transaction } }`.

## How a server decodes this value

The server reverses the same encoding: base64-decode the header value to a
UTF-8 string, then `JSON.parse` it. In this SDK that's
`decodePaymentRequired`'s `base64ToUtf8` step in `src/x402-client.ts` (used
there for the `PAYMENT-REQUIRED` header, but the same decode logic applies to
`PAYMENT-SIGNATURE`).

## Run it

With the hardcoded sample payload:

```sh
npx tsx encode-payment-signature.ts
```

Or with your own JSON (as a single quoted argument):

```sh
npx tsx encode-payment-signature.ts '{"x402Version":2,"accepted":{"scheme":"exact"}}'
```

## Tests

```sh
npx vitest run contrib/examples/encode-payment-signature
```
