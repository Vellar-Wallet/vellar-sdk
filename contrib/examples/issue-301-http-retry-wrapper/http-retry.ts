/**
 * A shared retry wrapper for the SDK's HTTP call sites.
 *
 * Contributed for issue #301: retry handling is duplicated across call sites
 * instead of living centrally in `src/http-backend.ts`. This is the wrapper
 * that centralization needs, written against the real shape of those call
 * sites so it can be dropped into `createHttpWalletBackend` (and
 * `createPolicyClient`, which repeats the same pattern) without changing any
 * public signature.
 *
 * What is duplicated today. `src/http-backend.ts` has one private `post()`
 * helper and then repeats, three times:
 *
 *     const res = await post("/wallet/create", { ... });
 *     if (!res.ok) throw await toApiError(res);
 *     return (await res.json()) as { sessionId: string };
 *
 * `src/policy-client.ts` has the same `req()` shape again, with its own error
 * class. Neither retries at all, so a single dropped connection surfaces as a
 * failed wallet creation. Adding retry to each site separately is how call
 * sites drift apart — one grows a backoff, another doesn't, and a third
 * quietly retries something it must not.
 *
 * ── The part that actually matters: what must NOT be retried ──────────────
 *
 * Retrying HTTP is not a matter of looping until something works. Two of the
 * three wallet endpoints are unsafe to retry blindly:
 *
 *   - `POST /wallet/submit` submits a SIGNED transaction. If the request
 *     reaches the gateway and the response is lost, the transaction may
 *     already be on-chain. Retrying can double-submit. Only failures that
 *     prove the request never arrived are safe.
 *   - `POST /wallet/create` has the same hazard for wallet deployment.
 *
 * So the rule this wrapper enforces is: **retry only on positive evidence
 * that the server reached no decision.** That means
 *
 *   - a transport error (`fetch` threw): the request never completed;
 *   - HTTP 408 / 429 / 502 / 503 / 504: the server explicitly says it did not
 *     process the request, or asks for a retry.
 *
 * Everything else — any 2xx, any other 4xx, and a bare 500 — is terminal. A
 * 500 is deliberately NOT retried: it means the server ran the handler and
 * something failed partway, which is exactly the state where a retry can
 * double-submit. This mirrors the reasoning already written down in
 * `src/policy-types.ts` (`isRetryableStatus`) and `src/x402-guards.ts`
 * (`isRetryableSettleFailure`), so the SDK has one consistent story about
 * when a retry is safe.
 *
 * `retryable: false` (the default for a request whose method is not known to
 * be idempotent) switches the wrapper off entirely, so a call site opts in
 * rather than inheriting retries it never asked for.
 */

/** Status codes that mean "the server reached no decision" — safe to retry. */
export const RETRYABLE_STATUSES: readonly number[] = [408, 429, 502, 503, 504];

/**
 * Is this response status safe to retry?
 *
 * Note what is absent: 500. A 500 means the handler ran and failed partway;
 * whether the side effect happened is unknowable from the outside, so it is
 * treated as terminal. See the module comment.
 */
export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.includes(status);
}

export interface RetryPolicy {
  /**
   * Total attempts including the first. `1` disables retrying.
   * @default 3
   */
  maxAttempts?: number;
  /**
   * Delay before the first retry, in ms. Doubles each attempt.
   * @default 200
   */
  baseDelayMs?: number;
  /**
   * Upper bound on a single delay, in ms.
   * @default 2000
   */
  maxDelayMs?: number;
  /**
   * Random jitter as a fraction of the computed delay (0 disables it).
   * Spreads retries so concurrent clients don't resynchronize into a
   * thundering herd against a gateway that just came back up.
   * @default 0.25
   */
  jitter?: number;
  /** Injected sleep, for tests. Defaults to `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected RNG in `[0, 1)`, for tests. Defaults to `Math.random`. */
  random?: () => number;
  /** Observability hook fired before each retry (never before attempt 1). */
  onRetry?: (event: RetryEvent) => void;
}

export interface RetryEvent {
  /** The attempt that just failed, 1-based. */
  attempt: number;
  /** Total attempts allowed. */
  maxAttempts: number;
  /** Delay before the next attempt, in ms. */
  delayMs: number;
  /** Status that triggered the retry, or `undefined` for a transport error. */
  status?: number;
  /** The thrown error, when the failure was a transport error. */
  error?: unknown;
}

export interface RetryRequestOptions extends RetryPolicy {
  /**
   * Whether this request may be retried at all. Defaults to `false` — a call
   * site opts in, so a non-idempotent write is never retried by accident.
   */
  retryable?: boolean;
  /** Abort signal; an aborted request stops retrying immediately. */
  signal?: AbortSignal;
}

const DEFAULTS = {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 2000,
  jitter: 0.25,
} as const;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Exponential backoff with jitter for a given 1-based attempt number.
 *
 * `attempt` 1 yields roughly `baseDelayMs`, 2 roughly `2x`, 3 roughly `4x`,
 * each capped at `maxDelayMs`. Jitter is applied after the cap, so the result
 * can never exceed `maxDelayMs`.
 */
export function computeBackoffDelay(attempt: number, policy: RetryPolicy = {}): number {
  const base = policy.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const max = policy.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const jitter = policy.jitter ?? DEFAULTS.jitter;
  const random = policy.random ?? Math.random;

  const exponential = Math.min(base * 2 ** (attempt - 1), max);
  if (jitter <= 0) return exponential;

  // Subtractive jitter keeps the delay in [exp*(1-jitter), exp], so it stays
  // under maxDelayMs while still de-synchronizing concurrent clients.
  const spread = exponential * jitter;
  return Math.max(0, Math.round(exponential - random() * spread));
}

/** Thrown when a request is abandoned because its signal was aborted. */
export class RequestAbortedError extends Error {
  constructor() {
    super("HTTP request aborted");
    this.name = "RequestAbortedError";
  }
}

/**
 * Run `request` with retries, per the rules in the module comment.
 *
 * `request` receives the 1-based attempt number and must perform exactly one
 * HTTP call, resolving with the `Response` (including error statuses — a non-2xx
 * is a resolved response, not a throw) or rejecting on a transport failure.
 *
 * Returns the first response that is not retryable — which includes error
 * responses. Interpreting those stays with the caller, so this wrapper does not
 * need to know about `WalletApiError` or `PolicyApiError`. After the final
 * attempt the last response is returned (or the last transport error rethrown),
 * so an exhausted retry looks exactly like a call that never retried.
 */
export async function fetchWithRetry(
  request: (attempt: number) => Promise<Response>,
  options: RetryRequestOptions = {},
): Promise<Response> {
  const maxAttempts = options.retryable === true ? (options.maxAttempts ?? DEFAULTS.maxAttempts) : 1;
  const sleep = options.sleep ?? defaultSleep;

  if (maxAttempts < 1) {
    throw new RangeError(`maxAttempts must be >= 1, got ${maxAttempts}`);
  }

  for (let attempt = 1; ; attempt++) {
    if (options.signal?.aborted) throw new RequestAbortedError();

    let response: Response | undefined;
    let error: unknown;

    try {
      response = await request(attempt);
      if (!isRetryableStatus(response.status)) return response;
    } catch (err) {
      error = err;
      // An abort is a deliberate cancellation, never a transient fault.
      if (options.signal?.aborted) throw err;
    }

    const isLast = attempt >= maxAttempts;
    if (isLast) {
      // Exhausted: hand back exactly what a non-retrying call would produce.
      if (response) return response;
      throw error;
    }

    const delayMs = computeBackoffDelay(attempt, options);
    options.onRetry?.({
      attempt,
      maxAttempts,
      delayMs,
      status: response?.status,
      error,
    });

    await sleep(delayMs);
  }
}

/**
 * Bind a retry policy to a `post`-style helper, producing the single choke
 * point `src/http-backend.ts` is missing.
 *
 * The returned function takes the same `(path, body)` arguments the existing
 * private `post()` does, plus a per-call `retryable` flag — so migrating a call
 * site is a one-line change and the retry decision is visible at the call site
 * rather than buried in the transport.
 */
export function createRetryingPost(
  post: (path: string, body: unknown) => Promise<Response>,
  policy: RetryPolicy = {},
): (path: string, body: unknown, options?: RetryRequestOptions) => Promise<Response> {
  return (path, body, options = {}) =>
    fetchWithRetry(() => post(path, body), { ...policy, ...options });
}
