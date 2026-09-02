# Shared HTTP Retry Wrapper

Self-contained reference for issue [#301](https://github.com/Vellar-Wallet/vellar-sdk/issues/301): extracting the duplicated HTTP retry handling into one wrapper, and migrating the existing call sites onto it.

## Run tests

```bash
npx vitest run contrib/examples/issue-301-http-retry-wrapper
```

## What's duplicated today

[`src/http-backend.ts`](../../../src/http-backend.ts) defines one private `post()` helper, then repeats the same request-and-check block three times:

```ts
const res = await post("/wallet/create", { ... });
if (!res.ok) throw await toApiError(res);
return (await res.json()) as { sessionId: string };
```

[`src/policy-client.ts`](../../../src/policy-client.ts) repeats the same shape again in its own `req()`, with its own error class. Neither retries at all, so a single dropped connection surfaces as a failed wallet creation.

Adding retry to each site separately is how call sites drift: one grows a backoff, another doesn't, and a third quietly retries something it must not.

## The part that actually matters: what must NOT be retried

Retrying HTTP isn't looping until something works. Two of the three wallet endpoints are unsafe to retry blindly, and getting this wrong costs real money:

| Endpoint | Retryable | Why |
| --- | --- | --- |
| `POST /wallet/connect` | **yes** | A pure lookup. No side effect, so a replay costs at most a wasted request. |
| `POST /wallet/create` | **no** | Deploys a wallet. If the response is lost, it may already have deployed. |
| `POST /wallet/submit` | **no** | Submits a **signed transaction**. Retrying can double-submit and pay twice. |

So the rule the wrapper enforces is: **retry only on positive evidence that the server reached no decision.**

- a transport error (`fetch` threw) — the request never completed;
- HTTP **408, 429, 502, 503, 504** — the server says it did not process the request, or asks for a retry.

Everything else is terminal, **including 500**. A 500 means the handler ran and failed partway, which is exactly the state where a retry can duplicate a write. A 503 means nothing was decided. That distinction is the whole safety argument, and it matches the reasoning already written down in [`src/policy-types.ts`](../../../src/policy-types.ts) (`isRetryableStatus`) and [`src/x402-guards.ts`](../../../src/x402-guards.ts) (`isRetryableSettleFailure`), so the SDK keeps one consistent story about when a retry is safe.

Retrying is also **opt-in**: `retryable` defaults to `false`, so a call site inherits no retries it didn't ask for. The safe default is the one that can't double-spend.

## Usage

```ts
import { fetchWithRetry, createRetryingPost } from "./http-retry";

// Wrap a single request:
const res = await fetchWithRetry(() => fetch(url, init), {
  retryable: true,       // opt in — reads only
  maxAttempts: 3,
  baseDelayMs: 200,
  onRetry: ({ attempt, delayMs, status }) =>
    console.warn(`attempt ${attempt} failed (${status ?? "network"}), retrying in ${delayMs}ms`),
});

// Or bind a policy to an existing `post()` helper — the choke point
// `src/http-backend.ts` is missing:
const send = createRetryingPost(post, { maxAttempts: 3 });
const res = await send("/wallet/connect", { keyId, network }, { retryable: true });
```

[`retrying-wallet-backend.ts`](./retrying-wallet-backend.ts) shows all three real call sites migrated, keeping `createHttpWalletBackend`'s interface, error type, and base-URL handling identical. The only change is that each call site declares its retryability and the retry lives in one place.

## Backoff

Exponential with subtractive jitter: attempt 1 waits about `baseDelayMs`, attempt 2 about `2x`, attempt 3 about `4x`, each capped at `maxDelayMs`.

Jitter is applied *after* the cap and only ever subtracts, so a delay stays within `[exp * (1 - jitter), exp]` and can never exceed `maxDelayMs`. Jitter matters when a gateway comes back up: without it, every client that failed at the same moment retries at the same moment.

`sleep` and `random` are injectable, so the tests assert exact delay sequences without waiting.

## Semantics

| Case | Result |
|------|--------|
| `retryable` omitted or `false` | Exactly one attempt, whatever the outcome |
| 408 / 429 / 502 / 503 / 504, opted in | Retried up to `maxAttempts` |
| 500 | Terminal — never retried |
| Any 2xx, or 4xx other than 408/429 | Returned immediately |
| `fetch` throws, opted in | Retried; the last error is rethrown if all attempts fail |
| Retries exhausted on an error status | The last response is returned, exactly as a non-retrying call would |
| Signal already aborted | `RequestAbortedError`, no request made |
| Aborted mid-flight | Abort error propagates; not treated as transient |
| `maxAttempts < 1` | `RangeError`, rather than looping forever |

Exhausted retries deliberately return the last response instead of a wrapper error, so callers keep interpreting failures exactly as they do today — this wrapper never needs to know about `WalletApiError` or `PolicyApiError`.

## Making the writes retryable

`/wallet/create` and `/wallet/submit` could be retried safely if the gateway accepted an **idempotency key** — a caller-generated id echoed back, so a replayed request returns the original result instead of performing the work twice. That is a protocol change on both sides, so it is out of scope here. Until then, silently retrying those endpoints is the bug this wrapper exists to prevent, which is why their non-retryability is fixed rather than configurable.

## Limits

This wraps request *execution*; it does not parse bodies or construct errors — deliberately, so the same wrapper serves both `http-backend.ts` and `policy-client.ts` despite their different error types. It does not honour a `Retry-After` header (worth adding when the gateway starts sending one), and it has no circuit breaker; see [`src/circuit-breaker.ts`](../../../src/circuit-breaker.ts) and [`contrib/examples/exponential-backoff`](../exponential-backoff) for the adjacent pieces.
