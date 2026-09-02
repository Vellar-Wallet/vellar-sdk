# Issue #263: Add rate limiting guard to passkeykit-connector authentication calls

## Contributor Sandbox

This file demonstrates rate limiting guard for passkeykit-connector authentication calls.
The actual rate limiter utilities live in `src/passkeykit-connector.ts`.

## RateLimitError

### Class

```typescript
export class RateLimitError extends Error {
  constructor(attempt: number, maxAttempts: number) {
    super(
      `Rate limit exceeded: ${attempt} authentication attempt${attempt !== 1 ? "s" : ""} made, maximum is ${maxAttempts}`,
    );
    this.name = "RateLimitError";
  }
}
```

## Rate Limiter Utilities

### `MAX_AUTH_ATTEMPTS`

```typescript
const MAX_AUTH_ATTEMPTS = 5;
```

### `attemptCache`

```typescript
export const attemptCache = new Map<string, number>();
```

### `resetAttemptCount(key: string): void`

Resets the attempt counter for a given connector identifier.

### `incrementAttemptCount(key: string): number`

Increments and returns the current attempt count for a connector.

### `checkRateLimit(key: string): void`

Checks if the connector has exceeded the rate limit for authentication attempts.
- Throws `RateLimitError` if count > MAX_AUTH_ATTEMPTS

## Connector Key

Rate limiter is keyed on connector identifier: `${appName}-${network}`

## Example Usage

```typescript
import { createPasskeyKitConnector, RateLimitError, attemptCache } from "vellar-sdk";

// Create connector
const connector = createPasskeyKitConnector({
  kit,
  backend,
  network: "testnet",
  appName: "Vellar",
});

// Rate limit is enforced per connector instance
// First 5 attempts allowed, 6th throws RateLimitError
```

## Test Scenarios

- ✅ Allows up to MAX_AUTH_ATTEMPTS (5) successful authentications
- ✅ Sixth attempt throws RateLimitError
- ✅ Attempt count resets after successful operation
- ✅ Tracks attempts per connector key (independent counters)
- ✅ Rejects excess attempts with typed RateLimitError
- ✅ Documented in README
```