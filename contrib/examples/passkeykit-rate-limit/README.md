# PasskeyKit Auth Rate Limiter (#263)

A client-side rate limiting guard specifically for `passkeykit-connector.ts` authentication attempts. Rejects repeated excessive calls to mitigate caller bugs or brute-force behavior.

## Configuration

The rate limiter requires a configuration object:
- `maxAttempts`: Maximum number of allowed authentication attempts within the time window (e.g. 5).
- `windowMs`: The time window in milliseconds for the rate limit (e.g. 60000 for 1 minute).
