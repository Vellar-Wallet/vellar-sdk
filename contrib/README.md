# Contributor Sandbox

This folder is the **only place** external contributor PRs may touch.
A PR against the `drips` branch that changes any file outside `contrib/` is closed automatically.

This folder contains reference implementations, standalone wrappers, and validation scripts addressing the assigned issues.

---

## 1. Fallback Path for x402-client Discovery Timeout (#279)

We implement `createX402ClientWithFallback` inside [contrib/x402-client-fallback.ts](file:///c:/Users/DELL/drips/luchi/vellar-sdk/contrib/x402-client-fallback.ts). 

### Behavior
- **`timeoutMs`**: Wraps the initial discovery request (`doFetch` call) in an `AbortController` timeout.
- **`fallbackResponse`**: If the request times out (aborted), it intercepts the failure and returns the configured fallback response (or a default 504 Gateway Timeout JSON response) with `isFallback: true` and `paid: false`.
- **Typings**: Leverages `X402FetchInitWithFallback` and `X402ResponseWithFallback`.

### Integration into Core
To integrate this into the main codebase:
1. Merge the properties `timeoutMs` and `fallbackResponse` into `X402FetchInit` inside `src/x402-types.ts`.
2. Merge `isFallback` into `X402Response` inside `src/x402-types.ts`.
3. Wrap the initial `doFetch` inside `x402Fetch` in `src/x402-client.ts` using the same `AbortController`/`setTimeout` logic.

---

## 2. Pre-release Smoke Test Script (#288)

We implement the smoke test script inside [contrib/smoke-test.mjs](file:///c:/Users/DELL/drips/luchi/vellar-sdk/contrib/smoke-test.mjs).

### Manual Run
Verify that the package core exports compile, load, and run correctly after building the package:
```sh
npm run build
node contrib/smoke-test.mjs
```

### Integration into Core
To run this automatically during releases, wire it in the root `package.json`'s `prepublishOnly` lifecycle hook:
```json
"prepublishOnly": "npm run typecheck && npm test && npm run build && node contrib/smoke-test.mjs"
```

---

## 3. Automated Changeset Validation in Release CI (#285)

We implement the validation script inside [contrib/validate-changeset.mjs](file:///c:/Users/DELL/drips/luchi/vellar-sdk/contrib/validate-changeset.mjs) and its unit tests inside [contrib/validate-changeset.test.ts](file:///c:/Users/DELL/drips/luchi/vellar-sdk/contrib/validate-changeset.test.ts).

### Manual Run
Run the validation script against simulated repository state:
```sh
node contrib/validate-changeset.mjs
```

### CI Check Integration
To enforce changeset entries for pull requests that touch source files (in `src/` or `packages/`), add a workflow step in `.github/workflows/ci.yml` (and check out with full history using `fetch-depth: 0`):
```yaml
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Validate Changeset
        if: github.event_name == 'pull_request'
        env:
          GITHUB_BASE_REF: ${{ github.base_ref }}
          PR_LABELS: ${{ join(github.event.pull_request.labels.*.name, ',') }}
        run: node contrib/validate-changeset.mjs
```

---

## 4. Stellar RPC Retry Outage Fixes (#277)

We implement a resilient wrapper for Stellar RPC servers inside [contrib/rpc-server.ts](file:///c:/Users/DELL/drips/luchi/vellar-sdk/contrib/rpc-server.ts).

### Retry Policy
- **Exponential Backoff with Jitter**: Retries failed calls up to 3 times (4 attempts total) with exponential delay ($100\text{ms}$ base, $1000\text{ms}$ max) and full random jitter to prevent retry storms.
- **Circuit Breaker**: Keys circuit breakers globally per RPC endpoint. If an endpoint fails 5 consecutive times, the breaker shifts to `OPEN` for a 10-second cooldown period, immediately fast-failing subsequent requests with `RpcCircuitBreakerError` to protect backend nodes.

### Integration into Core
To integrate this into the core SDK:
1. Re-export the wrapped `Server` class and `RpcCircuitBreakerError` from `src/rpc.ts`.
2. Swap the instantiation of `new rpc.Server(...)` for `new Server(...)` inside `src/balances-rpc.ts` and `src/tx-rpc.ts`.

---

## 5. Data Retention Guidance for Cached Session State (#292)

We implement the retention window inside [contrib/session-retention.ts](contrib/session-retention.ts),
with the full guidance in [contrib/session-retention.md](contrib/session-retention.md) and tests in
[contrib/session-retention.test.ts](contrib/session-retention.test.ts).

### Recommended Window
- **30 days of inactivity** (`DEFAULT_SESSION_MAX_AGE_MS`). Cached session state is not a credential
  (no key material; every signature still needs a live WebAuthn ceremony), but it is a durable link
  between a browser profile and an on-chain account, so it should not persist indefinitely.
- **Idle, not absolute**: age is measured from `lastActiveAt`, which `touch()` refreshes, so an
  active session renews while an abandoned one ages out.
- Shorten it for stricter deployments — a few hours for shared kiosks or custodial dashboards.
  See the deployment table in the guidance doc.

### Enforcement on Read
- **`withSessionRetention(adapter, { maxAgeMs })`** wraps any `SessionStorageAdapter`. On `load()`,
  state older than `maxAgeMs` yields `null` **and is cleared from the underlying storage** — expired
  state is evicted, not merely ignored.
- Wrapping the adapter rather than the store applies the window to every read path and composes with
  any adapter without the core store knowing retention exists.
- **`isSessionExpired(session, maxAgeMs?, now?)`** exposes the same rule as a pure helper.
- Unparseable `lastActiveAt` counts as expired; a future one (clock skew) never does; a failed
  eviction still reports expiry; a non-positive or `NaN` `maxAgeMs` throws a `RangeError` at wiring.

### Integration into Core
See [contrib/session-retention.md](contrib/session-retention.md) for the step-by-step recipe and the
proposed `README.md` section. In short:
1. Move `DEFAULT_SESSION_MAX_AGE_MS` and `isSessionExpired` into `src/session.ts`; export both from `src/index.ts`.
2. Add `maxAgeMs?: number` to `CreateSessionStoreOptions` and enforce it in `restore()`.
3. Add the proposed "Session retention" section to the root `README.md`.

> Note: `src/session.test.ts` does not currently parse on `dev` (an unterminated `it(` block in the
> teardown suite), which must be fixed before these tests can be ported there.

---

## 6. Direct Unit Tests for the Payments Client Relayer Constraints

We add [contrib/payments-client-relayer-constraints.test.ts](payments-client-relayer-constraints.test.ts),
testing `src/payments-client.ts` directly rather than only indirectly through
`payments.test.ts` / `payments.load.test.ts`.

### Coverage
- **Relayer timeout on every transfer path**: asserts `transfer()` is always called with
  `{ timeoutInSeconds: RELAYER_MAX_TIMEOUT_SECONDS }` across several from/to/amount
  combinations, plus a guard that the constant stays under the relayer's hard 60s ceiling
  (error 7002) — if a refactor ever drops the explicit option, sac-sdk's 300s default would
  return and this suite catches it at the source instead of at a confusing relayer rejection.
- **`InvalidRecipientError` boundaries**: invalid address, recipient equal to sender, and that
  the SAC client is never reached once the recipient is rejected.
- **`InvalidAmountError` boundaries**: zero and negative amounts, and that the SAC client is
  never reached once the amount is rejected.
- **`confirm()` submission gate**: `preparePayment()` alone never calls `kit.sign` or
  `backend.submitTransaction` — only calling the returned `confirm()` does, proving a payment
  cannot be submitted without the caller explicitly acting on the reviewed `PaymentReview`.

### Integration into Core
No source changes are proposed — this is additive test coverage for existing behavior in
`src/payments-client.ts`. A maintainer may choose to move this file to
`src/payments-client.test.ts` verbatim.

---

## 7. Direct Unit Tests for the HTTP Wallet Backend

We add [contrib/http-backend-tests.test.ts](http-backend-tests.test.ts), testing
`src/http-backend.ts` directly. It was previously covered only indirectly via
`client-backend-harness.test.ts`.

### Coverage
- **Every `toApiError` branch**: a JSON error body with `message`, a JSON body with only
  `error`, a non-JSON body (the `catch` fallthrough), and the fallback `Wallet API request
  failed (<status>)` message when the body has neither field.
- **`WalletApiError.status` and `.code`**: asserted directly off the thrown instance, including
  the case where `.code` is `undefined` because the body carried no `error` field.
- **All three documented endpoints** (`/wallet/create`, `/wallet/connect`, `/wallet/submit`)
  post the exact request shape, and `/wallet/connect`'s 404-as-`undefined` special case is
  covered separately from its generic error path.

### Integration into Core
No source changes are proposed — this is additive test coverage for existing behavior in
`src/http-backend.ts`. A maintainer may choose to move this file to `src/http-backend.test.ts`
verbatim.

---

## 8. License Decision: AGPL-3.0 Transitive Dependency

We record the finding in [contrib/license-decision.md](license-decision.md): the production
tree carries exactly one copyleft package, `@openzeppelin/relayer-sdk@1.10.0`
(AGPL-3.0-or-later), reached only via `passkey-kit@0.16.5 -> @openzeppelin/relayer-plugin-channels@0.20.0`.

### Verified
- The chain and its license, directly against `package-lock.json`.
- `passkey-kit` is a `devDependency` and an *optional* `peerDependency` — the AGPL branch
  carries `"dev": true` in the lockfile, so it is absent from a production install unless a
  consumer opts into `passkey-kit` themselves.
- No `package.json` in this repo lists it, and nothing under `src/`, `packages/cli/src`, or
  `packages/mcp-x402-payer/src` imports from `passkey-kit`.

### Decision
No action required on vellar-sdk's own licensing: the AGPL package is unreachable from
anything vellar-sdk ships and is never bundled into `dist/`. Full reasoning and the conditions
that would require revisiting this are in the doc.

### Integration into Core
Move [contrib/license-decision.md](license-decision.md) to `reference/license.md` (the
directory does not exist on `dev` yet).

---

## 9. Warn Loudly Before Any Mainnet Payment

We implement `confirmMainnetPayment` and `formatMainnetWarning` inside
[contrib/mainnet-payment-warning.ts](mainnet-payment-warning.ts), with tests in
[contrib/mainnet-payment-warning.test.ts](mainnet-payment-warning.test.ts).

### Behavior
- **No-op off mainnet.** Any network other than `"mainnet"` returns immediately — no banner,
  no prompt.
- **`formatMainnetWarning`**: an unmistakable notice showing network, asset, and amount,
  printed before anything is signed.
- **`confirmMainnetPayment`**: on mainnet, always prints the warning first (even with
  `assumeYes: true`, so a scripted run's logs still show what was spent), then either skips
  the prompt (`assumeYes`), refuses outright when input is non-interactive and `assumeYes` is
  not set (fails closed instead of hanging on an unanswerable prompt), or prompts and requires
  the literal answer `"YES"`. A refusal throws `RealFundsConfirmationDeclinedError` — nothing
  is signed.
- **`withNetwork`**: a pure helper to merge `network` onto any MCP payer result, so it appears
  at the top level even on responses without a `settlement` (e.g. "no payment required").

### Integration into Core
1. **CLI** (`packages/cli/src/commands/pay.ts`): add a `--yes` boolean option to `makePayCommand`
   (default `false`). Between step 2 (ceiling/sponsorship checks, ~line 202) and step 3
   (build-and-sign, ~line 204), call:
   ```ts
   await confirmMainnetPayment({
     network: opts.network,
     asset: chosen.asset ?? "?",
     amount: price.toString(),
     assumeYes: opts.yes,
   });
   ```
   wrapped in the existing top-level `try`, so `RealFundsConfirmationDeclinedError` is reported
   through the same `catch (err)` → `console.error` → `process.exit(1)` path already there.
2. **MCP payer startup** (`packages/mcp-x402-payer/src/bin.ts`): already logs `network:
   config.network` in the `"vellar x402 payer ready"` log line (lines 30-38) — no change
   needed there.
3. **MCP payer results** (`packages/mcp-x402-payer/src/payer.ts`): wrap each `QuoteResult` and
   `PayResult` return value in `withNetwork(result, config.network)` — currently `network` only
   appears inside `settlement`, which is absent on the "no payment required" / unpayable
   branches (e.g. the early return at `payer.ts:229`, the refusal branch around `payer.ts:263-268`,
    and the no-challenge return around `payer.ts:284-289`).

---

## 10. Fuzz Tests for Auth-Entry Validation (#442)

We add [contrib/auth-entry-fuzz/auth-entry-fuzz.test.ts](auth-entry-fuzz/auth-entry-fuzz.test.ts),
extending the coverage in `src/x402-auth-entry.test.ts` with structurally hostile XDR inputs.

### Coverage
- **Wrong ScVal types in each arg position**: string, u32, bool, map, and vec where an address
  or i128 is expected. Every case asserts the typed `AuthEntryMismatchError` and the specific
  `field` — never merely that something threw.
- **Deeply nested sub-invocations**: depth 1, 3, 10, and multiple siblings. The existing test
  covers one level; these exercise the length comparison against arbitrarily deep nesting.
- **i128 boundary amounts**: maximum (`2^127 - 1`), minimum (`-2^127`), negative, and zero.
  Both the refusal case (expected ≠ actual) and the acceptance case (expected = actual) at
  the boundaries.
- **Truncated and structurally invalid XDR**: empty buffer, single byte, random bytes,
  truncated valid entry, and raw non-XDR text. Every case asserts the function never returns
  normally on input it could not fully parse.

### Integration into Core
No source changes — these are additive fuzz tests for existing validation in
`src/x402-auth-entry.ts`. A maintainer may move this file to `src/x402-auth-entry.fuzz.test.ts`.

---

## 11. Load Test for the x402 Payment Path (#443)

We add [contrib/x402-load-test/x402-payment.load.test.ts](x402-load-test/x402-payment.load.test.ts),
following the structure and naming of `src/payments.load.test.ts`.

### What It Tests
- **Guard layer throughput at increasing concurrency**: the pure `selectRequirements` and
  `parseAmount` functions plus `assertAuthEntryInvocation`, driven at concurrency levels
  [1, 5, 10, 25, 50, 100] with 200 iterations per level. Reports p50/p95 latency and throughput.
- **Identical decisions under concurrency**: 50 workers × 100 iterations, asserting every
  guard decision is structurally identical. Any divergence indicates shared mutable state.
- **No unbounded memory growth**: 5,000 iterations of the full guard + validation pipeline,
  asserting heap growth stays under 10 MB. This is the failure an agent looping for hours
  would hit.

### Integration into Core
Wire this file into the existing load-test CI job in `.github/workflows/ci.yml` by adding
it to the `vitest.run` command alongside `src/payments.load.test.ts`. It is excluded from
`npm test` by the `*.load.test.ts` glob in `vitest.config.ts`.

---

## 12. Type-Level Verification of the Passkey-Kit Range (#444)

We add [contrib/passkey-kit-range/passkey-kit-range-check.test.ts](passkey-kit-range/passkey-kit-range-check.test.ts),
verifying that the `PasskeyKitLike` structural seam matches the real `PasskeyKit` class.

### What It Checks
- **`PasskeyKit extends PasskeyKitLike`**: the critical assignability check. If passkey-kit
  adds a required parameter to `createWallet`/`connectWallet`, or changes the return shape,
  this file fails at compile time.
- **Return type shape**: destructured fields `keyIdBase64`, `contractId`, and `signedTx` from
  `createWallet`, and `keyIdBase64` + `contractId` from `connectWallet`, verified against the
  actual return types.
- **`wallet` property**: must exist and be optional (the connector checks `kit.wallet` to
  decide whether to reconnect).
- **`connectWallet` keyId type**: must accept `string` (the connector passes `string` from
  `resumeKitConnection`).

### Limitations
This verifies against the installed devDependency (`^0.16.5`, the upper end of the declared
range `>=0.13.0 <0.17.0`). The lower end (0.13.0) would require installing that version in a
separate CI step — if the seam breaks there, the correct fix may be narrowing the declared
range rather than widening the seam.

### Integration into Core
No source changes. Runs as part of `npm test` (hermetic, type-level only). If the seam needs
narrowing, update the `peerDependencies` range in `package.json`.

---

## 13. Idempotency Key for Wallet Backend Submission (#446)

We implement [contrib/idempotency-key/idempotency-key.ts](idempotency-key/idempotency-key.ts)
with tests in [contrib/idempotency-key/idempotency-key.test.ts](idempotency-key/idempotency-key.test.ts).

### What It Does
- **Generates a UUID idempotency key per logical submission** (not per attempt). The same key
  is reused across retries of the same submission so the backend can deduplicate.
- **Distinguishes definite from ambiguous failures**: DNS resolution failure and connection
  refused mean the backend never saw the request (safe to retry with a fresh key via
  `DefiniteNetworkError`). Timeouts and connection resets are ambiguous — the request may
  have been received (surfaced as `AmbiguousSubmissionError` with the key attached).
- **Retries up to 3 times** on ambiguous failures with exponential backoff (100ms, 200ms,
  400ms).
- **Documents the server contract**: the backend must read `Idempotency-Key` from the request
  header and return the original response on a repeat key.

### Server Contract
```
POST /wallet/create
Header: Idempotency-Key: <uuid>
Body:   { keyId, contractId, network, signedTx }

Same key → original 200 (deduplicated).
Same key, in-flight → 409 Conflict.
Same key, original failed → allow retry.
Keys expire after 24 hours.
```

### Integration into Core
1. **`src/http-backend.ts`**: Accept an optional `Idempotency-Key` header on POST `/wallet/create`.
2. **`src/passkeykit-connector.ts`**: Wrap `backend.submitWalletCreation` with
   `withIdempotencyKey(backend)` so retries reuse the same key.
3. **`README.md`**: Document the `Idempotency-Key` header and server obligations.
