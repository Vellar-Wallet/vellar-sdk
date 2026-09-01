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
