import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rpc } from "@stellar/stellar-sdk";
import { Server, getBreaker, resetBreakerRegistry, RpcCircuitBreakerError } from "./rpc-server";

describe("RpcServer backoff and circuit breaker", () => {
  beforeEach(() => {
    resetBreakerRegistry();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries on failure with exponential backoff and eventually propagates error", async () => {
    const getLatestLedgerSpy = vi.spyOn(rpc.Server.prototype, "getLatestLedger")
      .mockRejectedValue(new Error("RPC Degraded"));

    const server = new Server("https://mock-rpc-url.org");
    const promise = server.getLatestLedger();

    // 1st attempt fails immediately.
    await vi.advanceTimersByTimeAsync(0);

    // baseDelay is 100ms. Since we have jitter, the delay is between 50ms and 100ms.
    expect(getLatestLedgerSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(getLatestLedgerSpy).toHaveBeenCalledTimes(2);

    // 2nd retry has delay of baseDelay * 2 = 200ms (jittered: 100ms-200ms).
    await vi.advanceTimersByTimeAsync(200);
    expect(getLatestLedgerSpy).toHaveBeenCalledTimes(3);

    // 3rd retry has delay of baseDelay * 4 = 400ms (jittered: 200ms-400ms).
    await vi.advanceTimersByTimeAsync(400);
    expect(getLatestLedgerSpy).toHaveBeenCalledTimes(4); // 1 initial + 3 retries = 4 attempts total

    await expect(promise).rejects.toThrow("RPC Degraded");
  });

  it("circuit breaker transitions to OPEN after 5 failures and blocks requests", async () => {
    const getLatestLedgerSpy = vi.spyOn(rpc.Server.prototype, "getLatestLedger")
      .mockRejectedValue(new Error("RPC Degraded"));

    const server = new Server("https://mock-rpc-url-2.org");

    // Make 1 call that fails 4 times (1 initial + 3 retries). This records 4 failures on the breaker.
    await expect(server.getLatestLedger()).rejects.toThrow("RPC Degraded");
    expect(getLatestLedgerSpy).toHaveBeenCalledTimes(4);

    const breaker = getBreaker("https://mock-rpc-url-2.org");
    expect(breaker.state).toBe("CLOSED");
    expect(breaker.failureCount).toBe(4);

    // Run one more call. The first attempt of this call will be the 5th failure.
    // This should immediately trip the breaker to OPEN.
    const promise = server.getLatestLedger();
    await vi.advanceTimersByTimeAsync(0);

    await expect(promise).rejects.toThrow(RpcCircuitBreakerError);
    expect(breaker.state).toBe("OPEN");
    // Only 1 more call got through (the 5th failure). Retries were blocked by the breaker!
    expect(getLatestLedgerSpy).toHaveBeenCalledTimes(5);

    // Subsequent calls should fail fast immediately without even hitting the spy.
    await expect(server.getLatestLedger()).rejects.toThrow(RpcCircuitBreakerError);
    expect(getLatestLedgerSpy).toHaveBeenCalledTimes(5); // Still 5 calls
  });

  it("circuit breaker cooldown leads to HALF_OPEN and recovers on success", async () => {
    const getLatestLedgerSpy = vi.spyOn(rpc.Server.prototype, "getLatestLedger")
      .mockRejectedValue(new Error("RPC Degraded"));

    const server = new Server("https://mock-rpc-url-3.org");
    const breaker = getBreaker("https://mock-rpc-url-3.org");

    // Trip the breaker to OPEN: need 5 failures.
    // 1st request makes 4 attempts (4 failures)
    await expect(server.getLatestLedger()).rejects.toThrow("RPC Degraded");
    // 2nd request makes 1 attempt (5th failure) and trips breaker to OPEN
    await expect(server.getLatestLedger()).rejects.toThrow(RpcCircuitBreakerError);
    expect(breaker.state).toBe("OPEN");
    expect(getLatestLedgerSpy).toHaveBeenCalledTimes(5);

    // Fast-forward by 10s (cooldown period)
    await vi.advanceTimersByTimeAsync(10000);

    // Next request should transition the breaker to HALF_OPEN and allow a test request.
    getLatestLedgerSpy.mockResolvedValue({ sequence: 100 } as any);

    const result = await server.getLatestLedger();
    expect(result.sequence).toBe(100);
    expect(breaker.state).toBe("CLOSED");
    expect(breaker.failureCount).toBe(0);
    expect(getLatestLedgerSpy).toHaveBeenCalledTimes(6);
  });
});
