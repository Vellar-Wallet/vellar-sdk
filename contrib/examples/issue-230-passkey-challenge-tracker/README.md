# Passkey challenge tracker

Self-contained reference for issue [#230](https://github.com/Vellar-Wallet/vellar-sdk/issues/230): reject stale passkey assertions in `passkeykit-connector.ts` with typed errors.

`ChallengeTracker` tracks single-use, TTL-bounded challenges: `register()`
records a freshly-issued one; `consume()` validates and single-use-consumes
it, throwing a distinct typed error for each failure mode:

- `PasskeyAssertionExpiredError` — the challenge is older than the TTL. The
  caller should ask the user to retry.
- `PasskeyAssertionReplayedError` — the challenge was already consumed
  once. A genuine replay attempt, worth logging/alerting on.

## Run it

```sh
npx tsx passkey-challenge-tracker.ts
```

## Tests

```sh
npx vitest run contrib/examples/issue-230-passkey-challenge-tracker
```
