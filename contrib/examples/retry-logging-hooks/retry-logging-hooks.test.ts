import { describe, expect, it, vi } from "vitest";
import {
  executeWithRetryLogging,
  type RetryPayload,
} from "./retry-logging-hooks";

describe("retry-logging-hooks (Issue #245)", () => {
  it("succeeds on first attempt without triggering onRetry", async () => {
    const fn = vi.fn(async () => "ok");
    const onRetry = vi.fn();

    const res = await executeWithRetryLogging(fn, {
      maxAttempts: 3,
      onRetry,
    });

    expect(res).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("invokes onRetry hook with attempt number, operation name, and error", async () => {
    let call = 0;
    const err = new Error("transient failure");
    const fn = vi.fn(async () => {
      call++;
      if (call < 3) throw err;
      return "recovered";
    });
    const retryEvents: RetryPayload[] = [];

    const res = await executeWithRetryLogging(fn, {
      maxAttempts: 4,
      operationName: "pollTransactionState",
      onRetry: (e) => {
        retryEvents.push(e);
      },
    });

    expect(res).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(retryEvents).toEqual([
      { attempt: 1, operation: "pollTransactionState", error: err },
      { attempt: 2, operation: "pollTransactionState", error: err },
    ]);
  });

  it("throws last error when maxAttempts exhausted", async () => {
    const err = new Error("permanent error");
    const fn = vi.fn(async () => {
      throw err;
    });

    await expect(
      executeWithRetryLogging(fn, {
        maxAttempts: 2,
        operationName: "fetchWithSignature",
      }),
    ).rejects.toThrow("permanent error");
  });
});
