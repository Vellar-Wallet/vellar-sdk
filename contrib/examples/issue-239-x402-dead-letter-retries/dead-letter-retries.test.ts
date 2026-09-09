import { describe, expect, it, vi } from "vitest";
import { retryPaymentWithDeadLetter } from "./dead-letter-retries";

describe("retryPaymentWithDeadLetter", () => {
  it("returns success on the first attempt without retrying", async () => {
    const attempt = vi.fn(async () => "paid");

    const result = await retryPaymentWithDeadLetter(attempt, { maxAttempts: 3 });

    expect(result).toEqual({ outcome: "success", value: "paid", attempts: 1 });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("retries after a failure and succeeds on a later attempt", async () => {
    let calls = 0;
    const attempt = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error(`transient failure ${calls}`);
      return "paid";
    });

    const result = await retryPaymentWithDeadLetter(attempt, { maxAttempts: 5 });

    expect(result).toEqual({ outcome: "success", value: "paid", attempts: 3 });
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("returns a typed dead-letter result after exhausting all attempts", async () => {
    const attempt = vi.fn(async () => {
      throw new Error("payment gateway down");
    });

    const result = await retryPaymentWithDeadLetter(attempt, { maxAttempts: 3 });

    expect(result.outcome).toBe("dead-letter");
    if (result.outcome === "dead-letter") {
      expect(result.attempts).toBe(3);
      expect(result.failures).toHaveLength(3);
      expect((result.lastError as Error).message).toBe("payment gateway down");
    }
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("records every attempt's failure in order", async () => {
    let calls = 0;
    const attempt = vi.fn(async () => {
      calls++;
      throw new Error(`failure ${calls}`);
    });

    const result = await retryPaymentWithDeadLetter(attempt, { maxAttempts: 3, baseDelayMs: 0 });

    expect(result.outcome).toBe("dead-letter");
    if (result.outcome === "dead-letter") {
      expect(result.failures.map((f) => f.attempt)).toEqual([1, 2, 3]);
      expect(result.failures.map((f) => (f.error as Error).message)).toEqual([
        "failure 1",
        "failure 2",
        "failure 3",
      ]);
    }
  });

  it("calls onDeadLetter exactly once, only on terminal failure", async () => {
    const onDeadLetter = vi.fn();
    const failingAttempt = vi.fn(async () => {
      throw new Error("always fails");
    });

    await retryPaymentWithDeadLetter(failingAttempt, { maxAttempts: 2, onDeadLetter });
    expect(onDeadLetter).toHaveBeenCalledTimes(1);
    expect(onDeadLetter.mock.calls[0][0].outcome).toBe("dead-letter");

    onDeadLetter.mockClear();
    const succeedingAttempt = vi.fn(async () => "paid");
    await retryPaymentWithDeadLetter(succeedingAttempt, { maxAttempts: 2, onDeadLetter });
    expect(onDeadLetter).not.toHaveBeenCalled();
  });

  it("never calls onDeadLetter per-attempt, only after the final one", async () => {
    const onDeadLetter = vi.fn();
    let calls = 0;
    const attempt = vi.fn(async () => {
      calls++;
      throw new Error(`failure ${calls}`);
    });

    await retryPaymentWithDeadLetter(attempt, { maxAttempts: 4, onDeadLetter, baseDelayMs: 0 });

    expect(onDeadLetter).toHaveBeenCalledTimes(1);
    expect(attempt).toHaveBeenCalledTimes(4);
  });

  it("rejects a maxAttempts less than 1", async () => {
    await expect(
      retryPaymentWithDeadLetter(async () => "x", { maxAttempts: 0 }),
    ).rejects.toThrow("maxAttempts must be at least 1");
  });

  it("succeeds with maxAttempts of exactly 1 and no retry", async () => {
    const attempt = vi.fn(async () => "paid");
    const result = await retryPaymentWithDeadLetter(attempt, { maxAttempts: 1 });

    expect(result).toEqual({ outcome: "success", value: "paid", attempts: 1 });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("dead-letters immediately with maxAttempts of exactly 1 on failure", async () => {
    const attempt = vi.fn(async () => {
      throw new Error("fails once");
    });
    const result = await retryPaymentWithDeadLetter(attempt, { maxAttempts: 1 });

    expect(result.outcome).toBe("dead-letter");
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
