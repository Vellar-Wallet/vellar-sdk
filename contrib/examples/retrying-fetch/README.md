# Retrying fetch wrapper

Wraps `fetch` with a configurable number of retries on network failure (a
thrown error), waiting a fixed delay between attempts. A resolved response —
even a non-2xx one — is returned as-is on the first attempt; only a thrown
error (e.g. DNS/connection failure) triggers a retry.

## Run it

```sh
npx tsx retrying-fetch.ts
```

Uses a mock fetch that fails twice with a network error, then succeeds:

```
Succeeded after 3 attempts, status 200
```

## Tests

Uses a mock fetch and an injected no-op `sleep`, so the tests run instantly
with no real delays:

```sh
npx vitest run contrib/examples/retrying-fetch
```
