# Simple fixed-count retry

Wraps an async function call with a simple fixed-count retry loop: try
again immediately, up to `maxAttempts` times, logging each attempt number.

## Run it

```sh
npx tsx simple-retry.ts
```

Runs against a function that fails on the first two calls and succeeds on
the third:

```
Attempt 1/5
Attempt 2/5
Attempt 3/5
Result: success
```

## Simple retry vs. exponential backoff

This wrapper retries **immediately**, with no delay between attempts — fine
for a quick, cheap operation, or when the caller wants to fail fast after a
bounded number of tries. It has no concept of a delay, jitter, or a growing
wait time.

Exponential backoff (see e.g. the `retrying-fetch` example) waits
progressively longer between attempts (`delay * 2^attempt`, often with
jitter). That's the right choice against a real network call or a shared
service that might be rate-limiting or momentarily overloaded — retrying
instantly in a tight loop can make things worse, not better. Reach for this
simple version only when you know the failure is likely to clear
immediately (e.g. a transient in-memory race) rather than a network or
service-level issue.

## Tests

```sh
npx vitest run contrib/examples/simple-retry
```
