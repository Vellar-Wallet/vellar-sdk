# Retrying Transaction Submitter

A reference implementation demonstrating retry logic with exponential backoff for transaction submission.

## Overview

This example shows how to:
- Wrap a submission function with automatic retry logic
- Implement exponential backoff between retry attempts
- Set maximum retry attempts
- Provide clear error messages when all attempts are exhausted

## Flow

1. **Submit** - Attempt to submit a transaction
2. **Retry on failure** - If submission fails, wait with exponential backoff
3. **Succeed or exhaust** - Either succeed before max attempts or fail with a clear error

## Backoff Calculation

The exponential backoff formula used:
```
delay = baseDelay * (2 ^ attemptNumber)
```

Example with baseDelay=100ms:
- Attempt 1: immediate
- Attempt 2: wait 100ms
- Attempt 3: wait 200ms
- Attempt 4: wait 400ms
- Attempt 5: wait 800ms

## Usage

```typescript
import { RetryingSubmitter } from './retrying-submitter';

const submitter = new RetryingSubmitter({
  maxAttempts: 5,
  baseDelayMs: 100,
});

try {
  const result = await submitter.submit(async () => {
    // Your submission logic here
    return await submitTransaction(tx);
  });
  console.log('Success:', result);
} catch (error) {
  console.error('All attempts exhausted:', error.message);
}
```

## Running the Examples

```bash
# Example with eventual success
npx ts-node example-success.ts

# Example with all attempts exhausted
npx ts-node example-failure.ts
```

## Implementation Details

- Configurable maximum attempts and base delay
- Exponential backoff prevents overwhelming the service
- Clear error messages distinguish temporary failures from exhaustion
- Logs each attempt for debugging
