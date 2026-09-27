import { describe, expect, it, vi } from "vitest";
import {
  CircuitOpenError,
  FacilitatorServerError,
  PaymentRejectedError,
  withX402CircuitBreaker,
} from "./facilitator-health-probe";

describe("facilitator health probe circuit breaker (#419)", () => {
  it("opens circuit after repeated transport-level failures and fast-fails with CircuitOpenError", async () => {
    let callCount = 0;
    const failingTransport = vi.fn().mockImplementation(async () => {
      callCount++;
      throw new Error("Network connection reset by peer");
    });

    const { execute, breaker } = withX402CircuitBreaker(failingTransport, {
      failureThreshold: 3,
      resetTimeoutMs: 10_000,
    });

    // 3 transport failures trip the circuit
    await expect(execute()).rejects.toThrow("Network connection reset by peer");
    await expect(execute()).rejects.toThrow("Network connection reset by peer");
    await expect(execute()).rejects.toThrow("Network connection reset by peer");

    expect(breaker.state).toBe("open");
    expect(callCount).toBe(3);

    // 4th call fast-fails without executing the wrapped function (no payment attempted)
    await expect(execute()).rejects.toThrow(CircuitOpenError);
    await expect(execute()).rejects.toThrow(/No payment was attempted and nothing was spent/);
    expect(callCount).toBe(3); // untouched!
  });

  it("5xx responses trip the circuit breaker", async () => {
    const server500 = vi.fn().mockImplementation(async () => {
      throw new FacilitatorServerError(503, "Facilitator unavailable");
    });

    const { execute, breaker } = withX402CircuitBreaker(server500, {
      failureThreshold: 2,
      resetTimeoutMs: 10_000,
    });

    await expect(execute()).rejects.toThrow(FacilitatorServerError);
    await expect(execute()).rejects.toThrow(FacilitatorServerError);

    expect(breaker.state).toBe("open");
    await expect(execute()).rejects.toThrow(CircuitOpenError);
  });

  it("402 challenge does NOT trip the circuit breaker", async () => {
    const normal402Response = vi.fn().mockResolvedValue({ status: 402, ok: true });

    const { execute, breaker } = withX402CircuitBreaker(normal402Response, {
      failureThreshold: 2,
    });

    // Multiple 402 challenges
    await execute();
    await execute();
    await execute();

    expect(breaker.state).toBe("closed");
  });

  it("PaymentRejectedError (deterministic policy refusal) does NOT trip the breaker", async () => {
    const policyRefusal = vi.fn().mockImplementation(async () => {
      throw new PaymentRejectedError("Exceeded on-chain spending limit");
    });

    const { execute, breaker } = withX402CircuitBreaker(policyRefusal, {
      failureThreshold: 2,
    });

    await expect(execute()).rejects.toThrow(PaymentRejectedError);
    await expect(execute()).rejects.toThrow(PaymentRejectedError);
    await expect(execute()).rejects.toThrow(PaymentRejectedError);

    // Stays closed because policy rejections prove the facilitator is alive
    expect(breaker.state).toBe("closed");
  });
});
