// Example: wrap fetch with a configurable number of retries on network
// failure (a thrown error — e.g. DNS/connection failure), waiting a fixed
// delay between attempts. Does NOT retry on a successful response, even a
// non-2xx one — only a thrown error is treated as retryable.
//
// Run with: npx tsx retrying-fetch.ts

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface RetryingFetchOptions {
  maxRetries: number;
  delayMs: number;
  /** Injectable sleep, so tests can run without real delays. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Wraps `fetchImpl`, retrying up to `maxRetries` additional times if it
 * throws (a network-level failure). A response that resolves — even a 4xx
 * or 5xx — is returned as-is on the first attempt; only a rejection
 * triggers a retry. Re-throws the last error once retries are exhausted.
 */
export function createRetryingFetch(fetchImpl: FetchLike, options: RetryingFetchOptions): FetchLike {
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  return async (url, init) => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
      try {
        return await fetchImpl(url, init);
      } catch (err) {
        lastError = err;
        if (attempt < options.maxRetries) {
          await sleep(options.delayMs);
        }
      }
    }
    throw lastError;
  };
}

async function main() {
  // A mock fetch that fails twice with a network error, then succeeds.
  let calls = 0;
  const mockFetch: FetchLike = async () => {
    calls++;
    if (calls < 3) {
      throw new Error("network error (mock)");
    }
    return new Response("ok", { status: 200 });
  };

  const retryingFetch = createRetryingFetch(mockFetch, { maxRetries: 3, delayMs: 100 });
  const response = await retryingFetch("https://example.com");
  console.log(`Succeeded after ${calls} attempts, status ${response.status}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
