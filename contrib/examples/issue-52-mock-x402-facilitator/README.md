# Mock x402 Facilitator

A self-contained example module implementing a mock x402 facilitator client
with `verify` and `settle` functions that return canned success or failure
results based on input flags.

Contributed for [issue #52](https://github.com/Vellar-Wallet/vellar-sdk/issues/52).

---

## Background

In the x402 payment flow the **facilitator** is a server-side component that
sits between the paying client and the Stellar network:

```
Client ──PAYMENT-SIGNATURE──► Resource server
                                  │
                                  ▼
                            Facilitator.verify()  ← validate the signed tx
                                  │  (success)
                                  ▼
                            Facilitator.settle()  ← submit on-chain
                                  │
                                  ▼
                            Resource server grants access
```

1. `verify` — validates the signed Soroban auth entry without touching the
   network. Fast, cheap, used to gate access.
2. `settle` — submits the signed transaction and returns the on-chain hash.

This mock skips all XDR/network work and instead returns canned responses
controlled by configuration flags. It is useful for:

- Unit-testing x402 client code without a live network
- Testing resource-server middleware (verify → gate access → settle)
- Exercising failure paths (spending limit exceeded, invalid signature, etc.)

---

## API

### `createMockFacilitator(config?)`

Creates a new mock facilitator. All config fields are optional.

```ts
const facilitator = createMockFacilitator({
  rejectVerify: false,        // set true to simulate a rejected payment
  rejectReason: "DAILY_LIMIT_EXCEEDED",  // error code on rejection
  rejectSettle: false,        // set true to simulate on-chain submission failure
  settleRejectReason: "SUBMISSION_FAILED",
  settleTxHash: undefined,    // fixed hash; derived deterministically when omitted
  latencyMs: 0,               // simulate network latency
});
```

#### `verify(paymentHeader, requirements): Promise<VerifyResult>`

```ts
const result = await facilitator.verify(header, requirements);
if (!result.success) {
  console.error(result.error);   // e.g. "DAILY_LIMIT_EXCEEDED"
}
```

#### `settle(paymentHeader, requirements): Promise<SettleResult>`

```ts
const result = await facilitator.settle(header, requirements);
if (result.success) {
  console.log(result.transaction); // on-chain tx hash
}
```

### `makeRequirements(overrides?)`

Returns a minimal valid `PaymentRequirements` fixture. Useful in tests:

```ts
const req = makeRequirements({ amount: "5000000", network: "stellar:pubnet" });
```

### `makePaymentHeader(requirements?)`

Returns a base64-encoded `PAYMENT-SIGNATURE` header value matching the shape
the Vellar SDK client produces:

```ts
const header = makePaymentHeader(makeRequirements());
```

---

## Usage examples

### Happy path

```ts
import { createMockFacilitator, makeRequirements, makePaymentHeader } from "./mock-x402-facilitator";

const req = makeRequirements();
const header = makePaymentHeader(req);
const facilitator = createMockFacilitator();

const verifyResult = await facilitator.verify(header, req);
// { success: true, message: "..." }

if (verifyResult.success) {
  const settleResult = await facilitator.settle(header, req);
  // { success: true, transaction: "a1b2c3..." }
}
```

### Simulating a spending-limit rejection

```ts
const facilitator = createMockFacilitator({
  rejectVerify: true,
  rejectReason: "DAILY_LIMIT_EXCEEDED",
});

const result = await facilitator.verify(header, req);
// { success: false, error: "DAILY_LIMIT_EXCEEDED", message: "..." }
```

### Simulating an on-chain submission failure

```ts
const facilitator = createMockFacilitator({
  rejectSettle: true,
  settleRejectReason: "NETWORK_CONGESTION",
});

const settle = await facilitator.settle(header, req);
// { success: false, error: "NETWORK_CONGESTION" }
```

### Simulating network latency

```ts
const facilitator = createMockFacilitator({ latencyMs: 200 });
// verify and settle will each take ~200 ms
```

---

## Common `rejectReason` codes

These mirror the error codes a real hosted facilitator returns:

| Code | Meaning |
|---|---|
| `DAILY_LIMIT_EXCEEDED` | On-chain spending policy blocked the payment |
| `INVALID_SIGNATURE` | The auth-entry signature did not verify |
| `AMOUNT_MISMATCH` | Signed amount does not match the requirements |
| `EXPIRED` | The signature expiration ledger has passed |
| `ASSET_NOT_SUPPORTED` | The token is not accepted by this facilitator |
| `MISSING_HEADER` | `PAYMENT-SIGNATURE` header was absent or empty |
| `INVALID_REQUIREMENTS` | Requirements were structurally malformed |

---

## Running the tests

The tests use [vitest](https://vitest.dev/), already a dev dependency of the repo.

```bash
# Run just this example's tests (from the repo root)
npx vitest run contrib/examples/issue-52-mock-x402-facilitator/mock-x402-facilitator.test.ts
```

Or run the full suite:

```bash
npm test
```

---

## File structure

```
contrib/examples/issue-52-mock-x402-facilitator/
├── README.md                          ← you are here
├── mock-x402-facilitator.ts           ← the module
└── mock-x402-facilitator.test.ts      ← vitest tests
```
