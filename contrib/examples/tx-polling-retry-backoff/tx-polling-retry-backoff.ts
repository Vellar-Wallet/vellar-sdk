/**
 * Issue #241: Exponential Backoff Polling with Jitter for Transaction Status.
 */

export interface PollingRetryOptions {
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  maxAttempts?: number;
  totalTimeoutMs?: number;
  jitter?: boolean;
  onRetry?: (attempt: number, delayMs: number, reason?: Error) => void;
}

export async function pollWithBackoff<T>(
  pollFn: (attempt: number) => Promise<T | null | undefined>,
  options: PollingRetryOptions = {}
): Promise<T> {
  const initialDelay = options.initialDelayMs ?? 100;
  const maxDelay = options.maxDelayMs ?? 2000;
  const factor = options.backoffFactor ?? 1.5;
  const maxAttempts = options.maxAttempts ?? 10;
  const totalTimeout = options.totalTimeoutMs ?? 15000;
  const useJitter = options.jitter ?? true;

  const startTime = Date.now();
  let attempt = 0;
  let currentDelay = initialDelay;

  while (attempt < maxAttempts) {
    attempt++;
    if (Date.now() - startTime > totalTimeout) {
      throw new Error(`Polling timed out after ${totalTimeout}ms across ${attempt} attempts`);
    }

    try {
      const result = await pollFn(attempt);
      if (result !== null && result !== undefined) {
        return result;
      }
    } catch (err) {
      // transient polling error -> retry
      options.onRetry?.(attempt, currentDelay, err instanceof Error ? err : new Error(String(err)));
    }

    if (attempt >= maxAttempts) {
      break;
    }

    const jitterOffset = useJitter ? (Math.random() * 0.4 - 0.2) * currentDelay : 0;
    const actualDelay = Math.min(maxDelay, Math.max(10, currentDelay + jitterOffset));

    options.onRetry?.(attempt, actualDelay);
    await new Promise((resolve) => setTimeout(resolve, actualDelay));
    currentDelay = Math.min(maxDelay, currentDelay * factor);
  }

  throw new Error(`Transaction status polling exceeded maximum attempts (${maxAttempts})`);
}
