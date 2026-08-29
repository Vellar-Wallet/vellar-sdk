# Mock x402 resource server

A minimal in-process mock of an x402-protected resource. Returns a mock
`PAYMENT-REQUIRED`-style payload (HTTP 402, base64 JSON) until a
`PAYMENT-SIGNATURE` header is present on the request, then returns the
protected resource. This mock never validates the header's actual
signature — a real facilitator would.

## Run it

```sh
npx tsx mock-x402-resource.ts
```

Demonstrates both cases: an unpaid request (402 + `PAYMENT-REQUIRED` header)
and a paid request (200 + resource body).

## Tests

Covers the unpaid and the paid request case:

```sh
npx vitest run contrib/examples/mock-x402-resource
```
