// Example: a mock x402 fetch call fails a few times with a transient error
// before succeeding, retried with exponential backoff between attempts.
//
// Run with: npx tsx x402-retry-backoff-demo.ts

export interface BackoffOptions {
  /** Delay before the first retry, in milliseconds. */
  baseDelayMs: number;
  /** Upper bound on any single delay, however many attempts have failed. */
  maxDelayMs: number;
  /** Total attempts allowed, including the first (non-retry) one. */
  maxAttempts: number;
}

/**
 * Exponential backoff: `baseDelayMs * 2^(attempt-1)`, capped at
 * `maxDelayMs`. `attempt` is 1-indexed and counts *failed* attempts so far
 * (the delay computed after the 1st failure is for the 2nd attempt, etc.).
 */
export function computeBackoffDelay(
  attempt: number,
  { baseDelayMs, maxDelayMs }: Pick<BackoffOptions, "baseDelayMs" | "maxDelayMs">,
): number {
  const delay = baseDelayMs * 2 ** (attempt - 1);
  return Math.min(delay, maxDelayMs);
}

export class TransientX402Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientX402Error";
  }
}

/**
 * Calls `attemptFn` up to `options.maxAttempts` times, waiting an
 * exponentially-growing delay (via `computeBackoffDelay`) between failures.
 * Resolves with the first successful result; rejects with the last error if
 * every attempt fails. `sleep` is injectable so tests don't need to wait in
 * real time.
 */
export async function fetchWithRetry<T>(
  attemptFn: (attempt: number) => Promise<T>,
  options: BackoffOptions,
  deps: { sleep?: (ms: number) => Promise<void>; log?: (line: string) => void } = {},
): Promise<T> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = deps.log ?? (() => {});

  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await attemptFn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === options.maxAttempts) break;
      const delay = computeBackoffDelay(attempt, options);
      log(`Attempt ${attempt} failed (${(err as Error).message}); retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastError;
}

/** A mock x402-paying fetch that throws TransientX402Error for its first
 * `failuresBeforeSuccess` calls, then succeeds. */
export function createFlakyMockPayment(failuresBeforeSuccess: number): (attempt: number) => Promise<{ paid: boolean }> {
  let calls = 0;
  return async (attempt: number) => {
    calls++;
    if (calls <= failuresBeforeSuccess) {
      throw new TransientX402Error(`facilitator returned 503 (call ${calls}, attempt ${attempt})`);
    }
    return { paid: true };
  };
}

async function main() {
  const payment = createFlakyMockPayment(3);

  const result = await fetchWithRetry(payment, { baseDelayMs: 100, maxDelayMs: 2000, maxAttempts: 5 }, { log: console.log });

  console.log(`Final result: ${JSON.stringify(result)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
