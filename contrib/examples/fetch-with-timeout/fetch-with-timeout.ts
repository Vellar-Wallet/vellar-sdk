// Example: wrap the global fetch function with a timeout using
// AbortController.
//
// Run with: npx tsx fetch-with-timeout.ts <url> <timeoutMs>

export class FetchTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(`Request to ${url} did not complete within ${timeoutMs}ms`);
    this.name = "FetchTimeoutError";
  }
}

export async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, { signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new FetchTimeoutError(url, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const [url, timeoutArg] = process.argv.slice(2);
  if (!url || !timeoutArg) {
    console.error("Usage: npx tsx fetch-with-timeout.ts <url> <timeoutMs>");
    process.exitCode = 1;
    return;
  }
  const timeoutMs = Number(timeoutArg);

  try {
    const response = await fetchWithTimeout(url, timeoutMs);
    console.log(`Response: ${response.status} ${response.statusText}`);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
