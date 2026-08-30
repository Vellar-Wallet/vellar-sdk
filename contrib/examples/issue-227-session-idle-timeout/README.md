# Session idle timeout

Self-contained reference for issue [#227](https://github.com/Vellar-Wallet/vellar-sdk/issues/227): harden session expiry handling in `session.ts` for idle connectors.

`checkIdleExpiry(session, idleTimeoutMs, now?)` checks how long a session has
been idle (`now - lastActiveAt`) and reports whether it's past the timeout,
along with a debug log helper (`logIdleExpiration`) for observability.

- The boundary is exclusive — idle for exactly `idleTimeoutMs` is still
  valid, so a session isn't punished for landing exactly on the threshold.
- A `lastActiveAt` in the future (clock skew, a corrupted persisted value)
  is never treated as expired.

## Run it

```sh
npx tsx session-idle-timeout.ts
```

## Tests

```sh
npx vitest run contrib/examples/issue-227-session-idle-timeout
```
