# full-payment-flow

Reference example demonstrating a full payment build, review, and submit flow using mocked SAC and backend clients.

## Flow

1. Build + simulate the SAC transfer.
2. Review the payment details.
3. Submit (with a simulated first-attempt failure and retry).

All API calls are mocked within the example.

## Usage

```ts
import { createMockSacClient, createMockBackend, runPaymentFlow } from "./index";

const result = await runPaymentFlow({
  from: "G...",
  to: "G...",
  token: { contractId: "C...", symbol: "USDC", decimals: 7 },
  amount: 1000000n,
  network: "testnet",
  sac: createMockSacClient(),
  backend: createMockBackend(true), // first submit fails
});

console.log(result.attempts, result.hash);