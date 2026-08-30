// Example: wrap an async function call with a simple fixed-count retry loop
// — no delay, no backoff, just "try again immediately, up to maxAttempts
// times". See the README for how this differs from exponential backoff.
//
// Run with: npx tsx simple-retry.ts

export async function simpleRetry<T>(fn: () => Promise<T>, maxAttempts: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`Attempt ${attempt}/${maxAttempts}`);
    try {
      return await fn();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function main() {
  // A function that fails twice, then succeeds on the third attempt.
  let calls = 0;
  const flaky = async () => {
    calls++;
    if (calls < 3) {
      throw new Error(`simulated failure on attempt ${calls}`);
    }
    return "success";
  };

  const result = await simpleRetry(flaky, 5);
  console.log(`Result: ${result}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
