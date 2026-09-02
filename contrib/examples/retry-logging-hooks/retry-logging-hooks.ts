/**
 * Structured logging hook handler and retry wrapper for asynchronous job-like sequences (Issue #245).
 */

export interface RetryPayload {
  attempt: number;
  operation?: string;
  error?: unknown;
  status?: unknown;
  metadata?: Record<string, unknown>;
}

export type OnRetryHook = (payload: RetryPayload) => void | Promise<void>;

export interface RetryExecutionOptions {
  maxAttempts: number;
  operationName?: string;
  onRetry?: OnRetryHook;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export async function executeWithRetryLogging<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryExecutionOptions,
): Promise<T> {
  const {
    maxAttempts,
    operationName = "asyncOperation",
    onRetry,
    delayMs = 0,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;

  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (onRetry) {
        try {
          await onRetry({
            attempt,
            operation: operationName,
            error: err,
          });
        } catch {
          // Logging hook exceptions should not prevent retry loop
        }
      }

      if (attempt < maxAttempts && delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  throw lastErr;
}
