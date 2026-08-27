# Fetch with a timeout

Wraps the global `fetch` function with a timeout using `AbortController`.
Prints a clear timeout error if the request does not complete in time,
instead of the default (and much less informative) `AbortError`.

## How this applies to x402 retries

`vellar-sdk`'s x402 client (`src/x402-client.ts`) accepts an injectable
`fetchImpl: FetchLike` for every request it makes (the initial fetch, and the
paid retry after a 402 challenge). Wrapping that injected fetch with a
timeout — as this example does — prevents a hung facilitator or resource
server from leaving an x402 payment flow stuck indefinitely; a caller that
wants bounded retries around x402 requests can compose this wrapper with a
retry loop (see the `simple-retry` example) around the same injected
`fetchImpl`.

## Run it

```sh
npx tsx fetch-with-timeout.ts <url> <timeoutMs>
```

Example:

```sh
npx tsx fetch-with-timeout.ts https://example.com 5000
```

A request that doesn't complete in time prints a clear error:

```
Error: Request to https://example.com did not complete within 1ms
```

## Tests

Uses a mock fetch that respects the abort signal, so the tests run without
depending on network timing:

```sh
npx vitest run contrib/examples/fetch-with-timeout
```
