/**
 * Simple exponential backoff helper.
 *
 * Computes an increasing delay (in milliseconds) for successive retry attempts.
 * Values grow by `multiplier` each attempt, but never exceed `maxDelay`.
 *
 * Delay formula:
 *   delay = min(baseDelay * (multiplier ^ attempt), maxDelay)
 */

export interface ExponentialBackoffOptions {
  /** Base delay in milliseconds for attempt 0. */
  baseDelay: number;
  /** Multiplier applied per attempt. Default: 2. */
  multiplier?: number;
  /** Maximum delay in milliseconds. Default: 30_000. */
  maxDelay: number;
}

export function computeBackoffDelay(options: ExponentialBackoffOptions, attempt: number): number {
  if (attempt < 0) throw new RangeError("attempt must be >= 0");

  const { baseDelay, multiplier = 2, maxDelay } = options;
  if (baseDelay < 0) throw new RangeError("baseDelay must be >= 0");
  if (multiplier <= 0) throw new RangeError("multiplier must be > 0");
  if (maxDelay < 0) throw new RangeError("maxDelay must be >= 0");

  const raw = baseDelay * Math.pow(multiplier, attempt);
  return Math.min(raw, maxDelay);
}

/**
 * Convenience generator of delay values for increasing attempt counts.
 */
export function* backoffDelays(options: ExponentialBackoffOptions): Generator<number> {
  let attempt = 0;
  while (true) {
    yield computeBackoffDelay(options, attempt);
    attempt++;
  }
}