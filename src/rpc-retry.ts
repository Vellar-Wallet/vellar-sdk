// Shared retry-with-backoff utility for the RPC-backed pieces under the
// "vellar-sdk/rpc" subpath (#297). Both the tx submitter (tx-rpc.ts) and the
// balance reader (balances-rpc.ts) make a single Soroban RPC call that can
// fail transiently (a dropped connection, a 5xx from the RPC node, a moment
// of node unavailability) — retrying a FEW times with exponential backoff
// (plus jitter, to avoid a thundering herd of clients retrying in lockstep)
// smooths over that without masking a genuinely broken call.
//
// This is deliberately generic over the operation: it knows nothing about
// Soroban, XDR, or transactions. Callers decide what's retryable via
// `isRetryable` — retrying a call that failed for a NON-transient reason
// (bad input, a real rejection) would just repeat the same failure `attempts`
// times before giving up, burning time for no benefit.

/** Configuration for {@link retryWithBackoff}. */
export interface RetryOptions {
  /** Maximum number of attempts, including the first (non-retry) call. Must be >= 1. */
  attempts: number;
  /** Base delay in ms before the first retry (attempt 2). Defaults to 200ms. */
  baseDelayMs?: number;
  /** Delay is never allowed to exceed this, before jitter is applied. Defaults to 5000ms. */
  maxDelayMs?: number;
  /**
   * Decides whether a thrown error is worth retrying. Defaults to "always
   * retry" — pass this when only some failures are transient (e.g. a network
   * error yes, a validation error no).
   */
  isRetryable?: (err: unknown) => boolean;
  /** Injected sleep, for tests. Defaults to a real `setTimeout`-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected randomness source for jitter, in `[0, 1)`. Defaults to `Math.random`. */
  random?: () => number;
}

const DEFAULT_BASE_DELAY_MS = 200;
const DEFAULT_MAX_DELAY_MS = 5000;

/**
 * Delay before retry number `retryIndex` (1 for the first retry, 2 for the
 * second, ...), in ms: full exponential backoff (`base * 2^(retryIndex-1)`),
 * capped at `maxDelayMs`, then "full jitter" — a uniform random value in
 * `[0, cappedDelay)` — per the AWS Architecture Blog's backoff-strategy
 * comparison. Full jitter (rather than a fixed delay, or backoff without
 * jitter) is what actually prevents synchronized retries across many clients
 * from re-colliding on the same schedule.
 *
 * Exported for testing the backoff curve directly, independent of an actual
 * retry loop.
 */
export function backoffDelayMs(
  retryIndex: number,
  baseDelayMs: number,
  maxDelayMs: number,
  random: () => number = Math.random,
): number {
  const capped = Math.min(maxDelayMs, baseDelayMs * 2 ** (retryIndex - 1));
  return random() * capped;
}

/**
 * Run `fn`, retrying with exponential backoff + full jitter on failure.
 *
 * Resolves with `fn`'s result on the first success. Rejects with the LAST
 * error seen once `attempts` calls have all failed (or the first non-retryable
 * error, if `isRetryable` is given and returns false) — never swallows a
 * failure silently.
 *
 * Usage (see tx-rpc.ts / balances-rpc.ts):
 * ```ts
 * const res = await retryWithBackoff(() => server.sendTransaction(tx), {
 *   attempts: 3,
 *   isRetryable: (err) => err instanceof NetworkError,
 * });
 * ```
 */
export async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const attempts = options.attempts;
  if (attempts < 1) {
    throw new RangeError(`retryWithBackoff: attempts must be >= 1 (got ${attempts})`);
  }
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const isRetryable = options.isRetryable ?? (() => true);
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isLastAttempt = attempt === attempts;
      if (isLastAttempt || !isRetryable(err)) throw err;
      await sleep(backoffDelayMs(attempt, baseDelayMs, maxDelayMs, random));
    }
  }
  // Unreachable (the loop always returns or throws), but keeps TS satisfied
  // and guards against a future refactor silently falling through.
  throw lastError;
}
