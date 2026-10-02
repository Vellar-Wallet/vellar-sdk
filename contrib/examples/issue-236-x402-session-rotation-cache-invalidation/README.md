# Cache invalidation on session key rotation for x402-client (#236)

Self-contained reference for issue [#236](https://github.com/Vellar-Wallet/vellar-sdk/issues/236): after an x402 session key rotates, `x402-client.ts` must not keep serving cached authorization results computed under the old key.

## Approach

Every cached `AuthorizationResult` is tagged with the `sessionKeyId` it was computed under. `invalidateForRotatedKey(oldSessionKeyId)` removes only the entries tagged with the retired key — not the whole cache (which would also discard still-valid results under a different, non-rotated key in a multi-session consumer), and not nothing (the bug this issue fixes).

Call `invalidateForRotatedKey` as part of your session key rotation flow:

```ts
const cache = createSessionAwareAuthorizationCache({
  debugLog: (msg, ctx) => logger.debug(msg, ctx),
});

// ...on rotation:
cache.invalidateForRotatedKey(oldSessionKeyId);
```

A debug log entry is emitted on every invalidation call (per issue #236's requirement), reporting the retired key and how many entries were cleared — including a zero count when the rotated key had no cached entries, so the log line is a reliable signal that invalidation ran, not just that it found something to do.

## Run tests

```bash
npx vitest run contrib/examples/issue-236-x402-session-rotation-cache-invalidation/session-rotation-cache-invalidation.test.ts
```
