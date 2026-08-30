/**
 * Demonstrates RateLimitedFetchQueue enqueuing more calls than the
 * concurrency limit. Uses a fake `fetchFn` with an artificial delay instead
 * of hitting the network. Run with:
 *
 *   npx tsx demo.ts
 */

import { RateLimitedFetchQueue } from "./rate-limited-fetch-queue";

const start = Date.now();
const elapsed = () => `${Date.now() - start}ms`;

const fakeFetch = (input: RequestInfo | URL): Promise<Response> => {
  const label = String(input);
  const delayMs = 300;

  console.log(`[${elapsed()}] start  ${label}`);

  return new Promise((resolve) => {
    setTimeout(() => {
      console.log(`[${elapsed()}] finish ${label}`);
      resolve(new Response(label));
    }, delayMs);
  });
};

async function main() {
  const queue = new RateLimitedFetchQueue({ maxConcurrent: 2, fetchFn: fakeFetch as typeof fetch });

  const urls = ["/a", "/b", "/c", "/d", "/e"];

  // Enqueue all five up front; only 2 should be "in flight" at a time.
  const results = await Promise.all(urls.map((url) => queue.enqueue(url).then((r) => r.text())));

  // Results line up with the enqueue order, regardless of completion order.
  console.log("results (in enqueue order):", results);
}

main();
