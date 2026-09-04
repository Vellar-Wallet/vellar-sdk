# Simple in-memory rate limiter

A fixed-window rate limiter keyed by a string id, tracking counts in memory.
Accepts a `limit` and a window length (`windowMs`) at construction; a call
past the limit within the current window is rejected. A new window (and a
fresh count) begins once `windowMs` has elapsed since the current window
started.

## Run it

```sh
npx tsx simple-rate-limiter.ts
```

Expected output (limit=3, calling the same key 5 times):

```
Calling with key 'user-1' 5 times (limit=3, window=1000ms):
  call 1: allowed
  call 2: allowed
  call 3: allowed
  call 4: rejected
  call 5: rejected
```

## Tests

An injectable clock lets the tests advance time deterministically instead of
depending on real delays:

```sh
npx vitest run contrib/examples/simple-rate-limiter
```
