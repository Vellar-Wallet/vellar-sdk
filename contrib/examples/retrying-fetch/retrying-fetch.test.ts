import { describe, expect, it, vi } from "vitest";
import { createRetryingFetch, type FetchLike } from "./retrying-fetch";

const noSleep = vi.fn(async () => {});

describe("createRetryingFetch", () => {
  it("succeeds on the first attempt with no retries needed", async () => {
    const mockFetch: FetchLike = vi.fn(async () => new Response("ok"));
    const retryingFetch = createRetryingFetch(mockFetch, { maxRetries: 3, delayMs: 10, sleep: noSleep });

    await retryingFetch("https://example.com");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("retries after a fixed number of failures, then succeeds", async () => {
    let calls = 0;
    const mockFetch: FetchLike = async () => {
      calls++;
      if (calls < 3) throw new Error("network error");
      return new Response("ok");
    };

    const retryingFetch = createRetryingFetch(mockFetch, { maxRetries: 3, delayMs: 10, sleep: noSleep });
    const response = await retryingFetch("https://example.com");

    expect(calls).toBe(3);
    expect(response.status).toBe(200);
  });

  it("does not retry a resolved non-2xx response", async () => {
    const mockFetch: FetchLike = vi.fn(async () => new Response("not found", { status: 404 }));
    const retryingFetch = createRetryingFetch(mockFetch, { maxRetries: 3, delayMs: 10, sleep: noSleep });

    const response = await retryingFetch("https://example.com");
    expect(response.status).toBe(404);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("re-throws the last error once retries are exhausted", async () => {
    const mockFetch: FetchLike = vi.fn(async () => {
      throw new Error("always fails");
    });
    const retryingFetch = createRetryingFetch(mockFetch, { maxRetries: 2, delayMs: 10, sleep: noSleep });

    await expect(retryingFetch("https://example.com")).rejects.toThrow("always fails");
    expect(mockFetch).toHaveBeenCalledTimes(3); // initial attempt + 2 retries
  });
});
