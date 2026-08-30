import { describe, expect, it } from "vitest";
import { computeBackoffDelay, createFlakyMockPayment, fetchWithRetry, TransientX402Error } from "./x402-retry-backoff-demo";

describe("computeBackoffDelay", () => {
  it("doubles with each attempt", () => {
    const opts = { baseDelayMs: 100, maxDelayMs: 10_000 };
    expect(computeBackoffDelay(1, opts)).toBe(100);
    expect(computeBackoffDelay(2, opts)).toBe(200);
    expect(computeBackoffDelay(3, opts)).toBe(400);
    expect(computeBackoffDelay(4, opts)).toBe(800);
  });

  it("caps the delay at maxDelayMs", () => {
    expect(computeBackoffDelay(10, { baseDelayMs: 100, maxDelayMs: 1000 })).toBe(1000);
  });
});

describe("fetchWithRetry", () => {
  it("succeeds on the first attempt without sleeping", async () => {
    const delays: number[] = [];
    const result = await fetchWithRetry(
      async () => "ok",
      { baseDelayMs: 100, maxDelayMs: 2000, maxAttempts: 3 },
      { sleep: async (ms) => void delays.push(ms) },
    );
    expect(result).toBe("ok");
    expect(delays).toEqual([]);
  });

  it("retries after transient failures and eventually succeeds", async () => {
    const delays: number[] = [];
    const payment = createFlakyMockPayment(3);

    const result = await fetchWithRetry(
      payment,
      { baseDelayMs: 100, maxDelayMs: 2000, maxAttempts: 5 },
      { sleep: async (ms) => void delays.push(ms) },
    );

    expect(result).toEqual({ paid: true });
    expect(delays).toEqual([100, 200, 400]); // one delay per failed attempt
  });

  it("logs a message before each retry, naming the attempt and the delay", async () => {
    const logs: string[] = [];
    const payment = createFlakyMockPayment(1);

    await fetchWithRetry(
      payment,
      { baseDelayMs: 50, maxDelayMs: 2000, maxAttempts: 3 },
      { sleep: async () => {}, log: (line) => logs.push(line) },
    );

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/Attempt 1 failed.*retrying in 50ms/);
  });

  it("throws the last error once maxAttempts is exhausted", async () => {
    const payment = createFlakyMockPayment(10); // never succeeds within maxAttempts
    await expect(
      fetchWithRetry(payment, { baseDelayMs: 10, maxDelayMs: 100, maxAttempts: 3 }, { sleep: async () => {} }),
    ).rejects.toThrow(TransientX402Error);
  });

  it("does not sleep after the final failed attempt (no wasted delay)", async () => {
    const delays: number[] = [];
    const payment = createFlakyMockPayment(10);

    await expect(
      fetchWithRetry(
        payment,
        { baseDelayMs: 10, maxDelayMs: 100, maxAttempts: 3 },
        { sleep: async (ms) => void delays.push(ms) },
      ),
    ).rejects.toThrow();

    expect(delays).toHaveLength(2); // delays before attempts 2 and 3, none after attempt 3
  });
});
