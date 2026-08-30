# Correlation ID Propagation (Issue #248)

Distributed tracing utility and fetch middleware for injecting and preserving `x-correlation-id` headers across backend calls.

## Usage

```ts
import { createCorrelatedFetch, generateCorrelationId } from "./correlation-id";

const tracedFetch = createCorrelatedFetch(fetch, () => generateCorrelationId());

const res = await tracedFetch("https://api.vellar.xyz/wallet/submit", {
  method: "POST",
  body: JSON.stringify({ signedXdr: "..." }),
});
```

## Running Tests

```sh
npx vitest run contrib/examples/correlation-id-propagation
```
