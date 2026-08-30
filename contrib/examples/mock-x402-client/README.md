# mock-x402-client

Self-contained example that provides a mock version of the `X402Client` interface
intended for unit tests.

## Usage

```ts
import { createMockX402Client } from "./index";

const client = createMockX402Client({ paid: true });

const result = await client.fetch("https://example.com/resource");
console.log(result.paid); // true

const payment = await client.createPayment(result.settlement!, { maxAmount: 100000n });
console.log(payment.header); // base64 payment payload
```

## Options

- `paid?: boolean` — if true, `fetch` resolves with `paid: true` and a sample settlement.
- `response?: Response` — override the returned underlying `Response` object.
- `samplePayment?: SignedPayment` — override the value returned by `createPayment`.
- `sampleRequirements?: PaymentRequirements` — override the requirements embedded in the sample payment.

Ref: `X402Client`, `SignedPayment`, `PaymentRequirements`.