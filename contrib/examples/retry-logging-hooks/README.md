# Retry Logging Hooks (Issue #245)

Structured logging hooks and wrapper utility for observing retry sequences across asynchronous background jobs and polling tasks.

## Usage

```ts
import { executeWithRetryLogging } from "./retry-logging-hooks";

const data = await executeWithRetryLogging(
  async (attempt) => {
    return await fetchEndpoint();
  },
  {
    maxAttempts: 3,
    operationName: "fetchResource",
    onRetry: (payload) => {
      console.warn(`[Retry #${payload.attempt}] ${payload.operation}:`, payload.error);
    },
  },
);
```

## Running Tests

```sh
npx vitest run contrib/examples/retry-logging-hooks
```
