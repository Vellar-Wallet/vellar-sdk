import { describe, expect, it } from "vitest";
import { FetchTimeoutError, fetchWithTimeout } from "./fetch-with-timeout";

/** A mock fetch that resolves after `delayMs`, respecting the abort signal
 * like a real fetch implementation would. */
function createDelayedFetch(delayMs: number): typeof fetch {
  return ((_url: string, init?: RequestInit) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response("ok")), delayMs);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("The operation was aborted", "AbortError"));
      });
    })) as typeof fetch;
}

describe("fetchWithTimeout", () => {
  it("resolves normally when the request completes before the timeout", async () => {
    const response = await fetchWithTimeout("https://example.com", 100, createDelayedFetch(10));
    expect(response.status).toBe(200);
  });

  it("throws FetchTimeoutError when the request exceeds the timeout", async () => {
    await expect(
      fetchWithTimeout("https://example.com", 10, createDelayedFetch(1000)),
    ).rejects.toThrow(FetchTimeoutError);
  });

  it("propagates a non-abort error unchanged", async () => {
    const failingFetch: typeof fetch = (async () => {
      throw new Error("DNS failure");
    }) as typeof fetch;
    await expect(fetchWithTimeout("https://example.com", 100, failingFetch)).rejects.toThrow(
      "DNS failure",
    );
  });
});
