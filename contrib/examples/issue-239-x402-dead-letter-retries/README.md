# Dead-letter handling for failed x402 payment retries (#239)

Self-contained reference for issue [#239](https://github.com/Vellar-Wallet/vellar-sdk/issues/239): x402 payments that repeatedly fail are currently retried indefinitely by consumer code, with no dead-letter or give-up mechanism from the SDK.

## Usage

```ts
const result = await retryPaymentWithDeadLetter(
  (attemptNumber) => submitPayment(paymentDetails),
  {
    maxAttempts: 5,
    baseDelayMs: 250, // doubles each retry: 250ms, 500ms, 1000ms, ...
    onDeadLetter: (deadLetter) => {
      // Persist for manual review / alerting — this fires exactly once,
      // only when every attempt has been exhausted.
      deadLetterQueue.push(deadLetter);
    },
  },
);

if (result.outcome === "success") {
  console.log(`Paid after ${result.attempts} attempt(s)`, result.value);
} else {
  console.error(`Payment dead-lettered after ${result.attempts} attempts`, result.lastError);
}
```

## Design

- `PaymentRetryResult<T>` is a typed union (`PaymentSuccess<T> | PaymentDeadLetter`) — the give-up state is a first-class return value, not an exception a consumer has to catch and reinterpret.
- `PaymentDeadLetter.failures` records every attempt's error, in order, with a timestamp — useful for diagnosing whether failures were transient-looking (timeouts) vs. a hard rejection from the first attempt.
- `onDeadLetter` fires exactly once per call, only on the terminal failure — never per-attempt, and never on success.
- Backoff is simple exponential (`baseDelayMs * 2^(attempt-1)`) between attempts, skipped after the final attempt.

## Run tests

```bash
npx vitest run contrib/examples/issue-239-x402-dead-letter-retries/dead-letter-retries.test.ts
```
