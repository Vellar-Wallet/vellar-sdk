import { describe, it, expect, vi } from "vitest";
import { pollWithBackoff } from "./tx-polling-retry-backoff";

describe("Issue #241 — Transaction Polling Retry with Backoff", () => {
  it("resolves when polling function succeeds after retries", async () => {
    let callCount = 0;
    const retryLogs: number[] = [];

    const result = await pollWithBackoff(
      async () => {
        callCount++;
        if (callCount < 3) return null;
        return { status: "success", txHash: "abc123" };
      },
      {
        initialDelayMs: 10,
        maxDelayMs: 50,
        jitter: false,
        onRetry: (attempt, delay) => retryLogs.push(attempt),
      }
    );

    expect(result.status).toBe("success");
    expect(callCount).toBe(3);
    expect(retryLogs.length).toBeGreaterThanOrEqual(2);
  });

  it("throws error when max attempts are exceeded", async () => {
    await expect(
      pollWithBackoff(async () => null, {
        initialDelayMs: 5,
        maxAttempts: 3,
        jitter: false,
      })
    ).rejects.toThrow(/exceeded maximum attempts/);
  });
});
