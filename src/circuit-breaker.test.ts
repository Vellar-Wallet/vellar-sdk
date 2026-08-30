import { describe, expect, it } from "vitest";
import {
  CircuitOpenError,
  createCircuitBreaker,
  createCircuitBreakingBackend,
} from "./circuit-breaker";

// A fake clock we can advance to drive the OPEN → HALF-OPEN → CLOSED transitions.
function fakeClock() {
  let t = 1000;
  return {
    now: () => t,
    advance: (ms: number) => (t += ms),
  };
}

describe("createCircuitBreaker", () => {
  it("starts closed", () => {
    const breaker = createCircuitBreaker();
    expect(breaker.state).toBe("closed");
    expect(breaker.failureCount).toBe(0);
  });

  it("stays closed while calls succeed", async () => {
    const breaker = createCircuitBreaker({ failureThreshold: 3 });
    await breaker.execute(async () => 1);
    await breaker.execute(async () => 2);
    expect(breaker.state).toBe("closed");
    expect(breaker.failureCount).toBe(0);
  });

  it("opens the circuit after the failure threshold, then fast-fails", async () => {
    const clock = fakeClock();
    const breaker = createCircuitBreaker({
      failureThreshold: 2,
      openDurationMs: 10_000,
      now: clock.now,
    });

    await expect(breaker.execute(async () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
    expect(breaker.failureCount).toBe(1);
    expect(breaker.state).toBe("closed");

    await expect(breaker.execute(async () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
    expect(breaker.state).toBe("open");

    // Now OPEN: the underlying fn must NOT be called — it fast-fails.
    let called = 0;
    await expect(
      breaker.execute(async () => {
        called++;
        return "ok";
      }),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(called).toBe(0);
  });

  it("opens immediately on a single failure in half-open (trial failed)", async () => {
    const clock = fakeClock();
    const breaker = createCircuitBreaker({
      failureThreshold: 3, // opened after 3
      openDurationMs: 10_000,
      now: clock.now,
    });
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(async () => Promise.reject(new Error("x")))).rejects.toThrow();
    }
    expect(breaker.state).toBe("open");

    // let cooldown elapse → HALF-OPEN
    clock.advance(10_000);
    expect(breaker.state).toBe("half-open");

    // a failed trial reopens
    await expect(breaker.execute(async () => Promise.reject(new Error("still down")))).rejects.toThrow();
    expect(breaker.state).toBe("open");
  });

  it("half-open allows a success to close the circuit again", async () => {
    const clock = fakeClock();
    const breaker = createCircuitBreaker({
      failureThreshold: 2,
      openDurationMs: 10_000,
      now: clock.now,
    });
    await expect(breaker.execute(async () => Promise.reject(new Error("x")))).rejects.toThrow();
    await expect(breaker.execute(async () => Promise.reject(new Error("x")))).rejects.toThrow();
    expect(breaker.state).toBe("open");

    clock.advance(10_000);
    expect(breaker.state).toBe("half-open");

    await expect(breaker.execute(async () => "recovered")).resolves.toBe("recovered");
    expect(breaker.state).toBe("closed");
    expect(breaker.failureCount).toBe(0);
  });

  it("limits trial calls in half-open while the cooldown has not elapsed", async () => {
    const clock = fakeClock();
    const breaker = createCircuitBreaker({
      failureThreshold: 1,
      openDurationMs: 50_000,
      halfOpenMaxCalls: 1,
      now: clock.now,
    });
    await expect(breaker.execute(async () => Promise.reject(new Error("x")))).rejects.toThrow();
    expect(breaker.state).toBe("open");

    clock.advance(50_000);
    expect(breaker.state).toBe("half-open");

    // The single trial succeeds and closes — the second call runs again.
    await expect(breaker.execute(async () => "probe-ok")).resolves.toBe("probe-ok");
    expect(breaker.state).toBe("closed");
    await expect(breaker.execute(async () => "after")).resolves.toBe("after");
  });

  it("a successful call resets the consecutive failure count", async () => {
    const breaker = createCircuitBreaker({ failureThreshold: 3 });
    await expect(breaker.execute(async () => Promise.reject(new Error("x")))).rejects.toThrow();
    await expect(breaker.execute(async () => Promise.reject(new Error("x")))).rejects.toThrow();
    expect(breaker.failureCount).toBe(2);
    await breaker.execute(async () => "ok");
    expect(breaker.failureCount).toBe(0);
    expect(breaker.state).toBe("closed");
  });

  it("reset() forces the circuit back closed", async () => {
    const breaker = createCircuitBreaker({ failureThreshold: 1 });
    await expect(breaker.execute(async () => Promise.reject(new Error("x")))).rejects.toThrow();
    expect(breaker.state).toBe("open");
    breaker.reset();
    expect(breaker.state).toBe("closed");
    await expect(breaker.execute(async () => "ok")).resolves.toBe("ok");
  });

  it("propagates the underlying error rather than masking it while closed", async () => {
    const breaker = createCircuitBreaker({ failureThreshold: 5 });
    const err = new Error("original");
    await expect(breaker.execute(async () => Promise.reject(err))).rejects.toBe(err);
  });
});

describe("createCircuitBreakingBackend", () => {
  it("routes every promise-returning method through the breaker", async () => {
    const clock = fakeClock();
    const breaker = createCircuitBreaker({
      failureThreshold: 1,
      openDurationMs: 10_000,
      now: clock.now,
    });
    const real = {
      submitWalletCreation: async (_input: { keyId: string }) => ({ sessionId: "s" }),
      lookupContractId: async (_input: { keyId: string }) => ({ contractId: "C", sessionId: "s" }),
      submitTransaction: async (_input: { signedXdr: string }) => ({ hash: "h" }),
      notAFunction: "value",
    };
    const wrapped = createCircuitBreakingBackend(real, breaker);

    await expect(
      wrapped.submitWalletCreation({ keyId: "k" }),
    ).resolves.toEqual({ sessionId: "s" });

    // Trip the breaker with one failing call, then confirm a call fast-fails
    // while OPEN without touching the underlying function.
    const ok = {
      submitTransaction: async (_input: { signedXdr: string }) =>
        Promise.reject(new Error("boom")),
    };
    const wrapped2 = createCircuitBreakingBackend(ok, breaker);
    await expect(wrapped2.submitTransaction({ signedXdr: "x" })).rejects.toThrow("boom");
    expect(breaker.state).toBe("open");

    await expect(wrapped.submitWalletCreation({ keyId: "k" })).rejects.toBeInstanceOf(
      CircuitOpenError,
    );

    // After the cooldown the breaker probes in HALF-OPEN; a healthy call closes it.
    clock.advance(10_000);
    expect(breaker.state).toBe("half-open");
    await expect(
      wrapped.submitWalletCreation({ keyId: "k" }),
    ).resolves.toEqual({ sessionId: "s" });
    expect(breaker.state).toBe("closed");

    // Non-function properties pass through untouched (still present as-is).
    expect(wrapped.notAFunction).toBe("value");
  });

  it("wraps the backend so underlying callers still receive typed results", async () => {
    const underlying = {
      submitTransaction: async (_input: { signedXdr: string }) => ({ hash: "abc" }),
    };
    const wrapped = createCircuitBreakingBackend(underlying);
    await expect(wrapped.submitTransaction({ signedXdr: "x" })).resolves.toEqual({
      hash: "abc",
    });
  });
});
