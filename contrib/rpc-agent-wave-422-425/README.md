# RPC & Agent Wave issues #422, #423, #424, #425

Contributor PRs may only touch `contrib/` (see `CONTRIBUTING.md` and the
`close-prs-outside-contrib` bot). The four assigned issues pre-approve `src/`
paths, but the bot does not read that exception (as observed in earlier waves).
This folder contains the complete, self-contained reference contracts and test
suites scoped so this PR remains open on `dev`.

The core in-tree wiring that belongs in `src/tx-rpc.ts`, `src/agents-facade.ts`,
and `src/x402-signer.ts` is fully implemented and tested on branch
`feat/rpc-and-agent-improvements` (commit `76a7a1d`) for maintainers to lift.

```bash
npx vitest run contrib/rpc-agent-wave-422-425
```

---

## #422 — Make the RPC token bucket shareable across submitters

`TokenBucket` in `rpc-token-bucket.ts` allows multiple `RpcTxSubmitter` instances
to share a single bucket instance, enabling process-wide rate limiting across
independent submitters.
- Accept an already-constructed `TokenBucket` on submitter options.
- Retain backwards-compatibility when `rateLimit` is supplied.
- Reject passing both `bucket` and `rateLimit` with an informative error.

**Lift:** See `src/tx-rpc.ts` in commit `76a7a1d` (`RpcTxSubmitterOptions.bucket`).

---

## #423 — Add retry-after handling to the RPC submitter

`TokenBucket.msUntilNextToken()` calculates the exact millisecond deficit wait time.
- `RateLimitError` exposes `retryAfterMs: number`, `retryAfter: number`, and `readonly retryable: true`.
- Upstream rate limits and `TRY_AGAIN_LATER` are surfaced as `RpcRateLimitError` (`status: 429`, `retryable: true`).
- Permanent RPC failures are classified as `RpcTransactionError` (`status: "ERROR"`, `resultCode`, `retryable: false`).

**Lift:** See `src/tx-rpc.ts` in commit `76a7a1d`.

---

## #424 — Add an on-chain verification step to `agents-facade.mint`

`verifyAgentSignerGrants` in `agent-verification.ts` reads back the deployed agent
signer and checks that the permissions and policy contracts on-chain match the
requested grants exactly.
- Defaults to `verify: true` to prevent silent drift or deployment of unconstrained keys.
- Categorizes divergence into `direction: "more_permissive"` (dangerous; missing policies or extra tokens, prompting immediate operator revocation), `less_permissive`, or `absent`.

**Lift:** See `src/agents-facade.ts` in commit `76a7a1d`.

---

## #425 — Expire-check agent keys before they are used to sign

`withSessionExpiryCheck` in `session-expiry.ts` validates `expiresAt` before signing
auth entries.
- Throws `SessionKeyExpiredError` (`retryable: false`, with reassurance that nothing was spent or submitted).
- Fires `onExpiringSoon(remainingMs)` when within `warnThresholdMs`.
- Supports deterministic testing via a `SignerClock` seam.
- Documents that client-side check is defense-in-depth; the smart account remains the authoritative enforcement layer.

**Lift:** See `src/x402-signer.ts` in commit `76a7a1d`.
