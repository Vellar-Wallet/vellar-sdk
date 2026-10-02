import { describe, it, expect, vi } from "vitest";
import {
  fetchWithTransientRetry,
  TransientFetchError,
  PermanentFetchError,
} from "./x402-fetch-transient-retries";

describe("Issue #244 — x402 Transient Fetch Retries", () => {
  it("retries on transient failure and succeeds", async () => {
    let tries = 0;
    const retrySpy = vi.fn();

    const result = await fetchWithTransientRetry(
      async () => {
        tries++;
        if (tries < 3) throw new TransientFetchError("503 Service Unavailable");
        return { data: "ok" };
      },
      { maxRetries: 3, initialDelayMs: 5, onRetry: retrySpy }
    );

    expect(result.data).toBe("ok");
    expect(tries).toBe(3);
    expect(retrySpy).toHaveBeenCalledTimes(2);
  });

  it("fails immediately on permanent error without retrying", async () => {
    let tries = 0;
    await expect(
      fetchWithTransientRetry(
        async () => {
          tries++;
          throw new Error("400 Bad Request — Invalid Address");
        },
        { maxRetries: 3 }
      )
    ).rejects.toThrow(PermanentFetchError);

    expect(tries).toBe(1);
  });
});
