# x402 retry with backoff demo

Demonstrates retrying a mock x402 payment call that fails a few times with a
transient error before succeeding, waiting an exponentially-growing delay
between attempts.

## Backoff calculation

`computeBackoffDelay(attempt, { baseDelayMs, maxDelayMs })` returns
`min(baseDelayMs * 2^(attempt-1), maxDelayMs)` — `attempt` is 1-indexed and
counts failed attempts so far. With `baseDelayMs: 100`:

| attempt | delay |
| --- | --- |
| 1 | 100ms |
| 2 | 200ms |
| 3 | 400ms |
| 4 | 800ms |
| ... | capped at `maxDelayMs` |

## Usage

```ts
import { fetchWithRetry } from "./x402-retry-backoff-demo";

const result = await fetchWithRetry(
  (attempt) => payX402Resource(url, attempt),
  { baseDelayMs: 100, maxDelayMs: 2000, maxAttempts: 5 },
  { log: console.log },
);
```

`sleep` (real by default) and `log` (no-op by default) are both injectable,
so a test can capture delays/log lines without waiting in real time.

## Run it

```sh
npx tsx x402-retry-backoff-demo.ts
```

Expected output (three transient failures, then success — total real wait
~700ms from the 100/200/400ms delays):

```
Attempt 1 failed (facilitator returned 503 (call 1, attempt 1)); retrying in 100ms
Attempt 2 failed (facilitator returned 503 (call 2, attempt 2)); retrying in 200ms
Attempt 3 failed (facilitator returned 503 (call 3, attempt 3)); retrying in 400ms
Final result: {"paid":true}
```

## Tests

```sh
npx vitest run contrib/examples/x402-retry-backoff-demo
```

Tests inject a non-waiting `sleep` so they run instantly while still
asserting on the exact delay values that would have been used.
