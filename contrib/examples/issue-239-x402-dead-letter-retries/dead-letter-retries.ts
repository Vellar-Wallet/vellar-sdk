// Reference for issue #239: x402 payments that repeatedly fail are
// currently retried indefinitely by consumer code, with no dead-letter or
// give-up mechanism provided by the SDK. This adds a max-retry-count wrapper
// with a typed terminal failure result and a hook for consumers to capture
// terminally failed payments (e.g. to persist them for manual review or an
// alerting pipeline), instead of leaving "give up after N tries" as
// something every consumer has to reimplement themselves.

export interface PaymentAttemptFailure {
  attempt: number;
  error: unknown;
  attemptedAt: number;
}

export interface PaymentSuccess<T> {
  outcome: "success";
  value: T;
  attempts: number;
}

/** A payment that exhausted its retry budget without succeeding — the
 * "dead letter" result. Distinct from a single attempt's failure: this is
 * the terminal state a consumer's retry loop currently has no typed way to
 * reach. */
export interface PaymentDeadLetter {
  outcome: "dead-letter";
  attempts: number;
  failures: PaymentAttemptFailure[];
  /** The error from the final attempt — usually what a consumer wants to
   * surface first, without digging through the full `failures` list. */
  lastError: unknown;
}

export type PaymentRetryResult<T> = PaymentSuccess<T> | PaymentDeadLetter;

export interface RetryWithDeadLetterOptions<T> {
  maxAttempts: number;
  /** Base delay in ms between attempts; doubles each retry (simple
   * exponential backoff). Defaults to 0 for fast, deterministic tests —
   * a real consumer should pass a meaningful value. */
  baseDelayMs?: number;
  /** Called exactly once, only when every attempt has been exhausted —
   * i.e. exactly when the returned result is a dead letter. Never called on
   * success, and never called per-attempt (that's what the returned
   * `failures` array is for). */
  onDeadLetter?: (deadLetter: PaymentDeadLetter) => void;
}

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * Retries `attempt` up to `maxAttempts` times. On success, returns a typed
 * `PaymentSuccess`. On exhausting every attempt, returns a typed
 * `PaymentDeadLetter` — this function never throws for an exhausted-retries
 * condition, so a consumer's retry loop no longer needs to catch and
 * reinterpret an exception as "well, I guess it's given up now"; the give-up
 * state is a first-class, typed return value.
 */
export async function retryPaymentWithDeadLetter<T>(
  attempt: (attemptNumber: number) => Promise<T>,
  options: RetryWithDeadLetterOptions<T>,
): Promise<PaymentRetryResult<T>> {
  const { maxAttempts, baseDelayMs = 0, onDeadLetter } = options;
  if (maxAttempts < 1) {
    throw new Error("maxAttempts must be at least 1");
  }

  const failures: PaymentAttemptFailure[] = [];

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    try {
      const value = await attempt(attemptNumber);
      return { outcome: "success", value, attempts: attemptNumber };
    } catch (error) {
      failures.push({ attempt: attemptNumber, error, attemptedAt: Date.now() });

      if (attemptNumber < maxAttempts) {
        await delay(baseDelayMs * 2 ** (attemptNumber - 1));
      }
    }
  }

  const deadLetter: PaymentDeadLetter = {
    outcome: "dead-letter",
    attempts: maxAttempts,
    failures,
    lastError: failures[failures.length - 1]?.error,
  };

  onDeadLetter?.(deadLetter);
  return deadLetter;
}
