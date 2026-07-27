# Poll a transaction hash until finality

Polls a status function for a transaction hash on an interval until it
reports `"success"` or `"failed"`, or rejects with `PollTimeoutError` once a
maximum number of attempts is exhausted.

## Run it

```sh
npx tsx poll-until-final.ts
```

Uses a mock status function that reports `"pending"` for the first two calls
and `"success"` on the third:

```
Final status after 3 calls: success
```

## Tests

Uses a mock status function and an injected no-op `sleep`, so the tests run
instantly with no real delays:

```sh
npx vitest run contrib/examples/poll-until-final
```
