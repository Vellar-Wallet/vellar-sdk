/**
 * Issue #244: Retry Semantics for Transient x402-Client Resource Fetches.
 */

export class TransientFetchError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "TransientFetchError";
  }
}

export class PermanentFetchError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "PermanentFetchError";
  }
}

export interface FetchRetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

export async function fetchWithTransientRetry<T>(
  fetchFn: () => Promise<T>,
  options: FetchRetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  let delay = options.initialDelayMs ?? 50;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fetchFn();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      // Check if transient error (e.g. 502, 503, 504, network timeout)
      const isTransient =
        error instanceof TransientFetchError ||
        /network|timeout|econnreset|502|503|504/i.test(error.message);

      if (!isTransient || attempt > maxRetries) {
        if (!isTransient) {
          throw new PermanentFetchError(`Permanent failure: ${error.message}`);
        }
        throw error;
      }

      options.onRetry?.(attempt, error);
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    }
  }

  throw new Error("Max retries reached");
}
