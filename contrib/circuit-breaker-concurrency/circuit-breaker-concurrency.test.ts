import { describe, expect, it } from "vitest";
import { CircuitOpenError, createCircuitBreakingBackend, createCircuitBreaker } from "../../src/circuit-breaker";

/**
 * Test suite for concurrent failure handling in circuit breaker.
 * 
 * Issue #845: Validate that the circuit breaker correctly handles concurrent 
 * failures without race conditions. When multiple requests fail simultaneously, 
 * the circuit should open appropriately and subsequent calls should fail fast.
 */

describe("Circuit Breaker — Concurrent Failure Handling (#845)", () => {
  it("handles concurrent failures correctly without race conditions", async () => {
    const breaker = createCircuitBreaker({
      failureThreshold: 3,
      openDurationMs: 5_000,
    });
    const real = {
      submitTransaction: async (_input: { signedXdr: string }) =>
        Promise.reject(new Error("service unavailable")),
    };
    const wrapped = createCircuitBreakingBackend(real, breaker);

    // Launch multiple concurrent failing calls
    const results = await Promise.allSettled([
      wrapped.submitTransaction({ signedXdr: "x1" }),
      wrapped.submitTransaction({ signedXdr: "x2" }),
      wrapped.submitTransaction({ signedXdr: "x3" }),
      wrapped.submitTransaction({ signedXdr: "x4" }),
    ]);

    // All should fail, but circuit should open after threshold
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(breaker.state).toBe("open");

    // Subsequent calls should fast-fail with CircuitOpenError
    await expect(wrapped.submitTransaction({ signedXdr: "x5" })).rejects.toBeInstanceOf(
      CircuitOpenError,
    );
  });

  it("concurrent failures do not cause race condition in failure count", async () => {
    const breaker = createCircuitBreaker({
      failureThreshold: 5,
      openDurationMs: 10_000,
    });
    const real = {
      submitTransaction: async (_input: { signedXdr: string }) =>
        Promise.reject(new Error("error")),
    };
    const wrapped = createCircuitBreakingBackend(real, breaker);

    // Launch 10 concurrent calls, but only 5 should trigger the threshold
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        wrapped.submitTransaction({ signedXdr: `x${i}` }),
      ),
    );

    // All initial calls fail with the underlying error
    expect(results.slice(0, 5).every((r) => r.status === "rejected")).toBe(true);
    // Circuit is now open
    expect(breaker.state).toBe("open");
  });

  it("subsequent concurrent calls all fast-fail when circuit is open", async () => {
    const breaker = createCircuitBreaker({
      failureThreshold: 2,
      openDurationMs: 10_000,
    });
    const real = {
      submitTransaction: async (_input: { signedXdr: string }) =>
        Promise.reject(new Error("error")),
    };
    const wrapped = createCircuitBreakingBackend(real, breaker);

    // Open the circuit
    await expect(wrapped.submitTransaction({ signedXdr: "x1" })).rejects.toThrow();
    await expect(wrapped.submitTransaction({ signedXdr: "x2" })).rejects.toThrow();
    expect(breaker.state).toBe("open");

    // Now launch multiple concurrent calls while OPEN
    const results = await Promise.allSettled([
      wrapped.submitTransaction({ signedXdr: "x3" }),
      wrapped.submitTransaction({ signedXdr: "x4" }),
      wrapped.submitTransaction({ signedXdr: "x5" }),
      wrapped.submitTransaction({ signedXdr: "x6" }),
    ]);

    // All should fail with CircuitOpenError (fast-fail)
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    results.forEach((r) => {
      if (r.status === "rejected") {
        expect(r.reason).toBeInstanceOf(CircuitOpenError);
      }
    });
  });
});
