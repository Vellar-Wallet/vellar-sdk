# Decode a mock PAYMENT-REQUIRED header

Decodes a base64-encoded JSON string as a mock x402 `PAYMENT-REQUIRED`
header value. x402 v2 carries payment requirements in the 402 response's
`PAYMENT-REQUIRED` header as base64 JSON — see `vellar-sdk`'s
`decodePaymentRequired` in `src/x402-client.ts` (this example reimplements
the same base64-decode step, standalone, for a raw string instead of a
`Response` object).

## Example

Encoded value:

```
eyJ4NDAyVmVyc2lvbiI6MiwiYWNjZXB0cyI6W3sic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoic3RlbGxhcjp0ZXN0bmV0IiwiYXNzZXQiOiJDVVNEQyIsImFtb3VudCI6IjI1MDAwMDAiLCJwYXlUbyI6IkNQQVlUTyJ9XX0=
```

Decoded output:

```json
{
  "x402Version": 2,
  "accepts": [
    {
      "scheme": "exact",
      "network": "stellar:testnet",
      "asset": "CUSDC",
      "amount": "2500000",
      "payTo": "CPAYTO"
    }
  ]
}
```

## Run it

```sh
npx tsx decode-payment-required.ts <base64String>
```

A string that isn't valid base64, or that decodes to something that isn't
valid JSON, prints a clear error instead of a raw exception.

## Tests

```sh
npx vitest run contrib/examples/decode-payment-required
```
