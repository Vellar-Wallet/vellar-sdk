import { beforeEach, describe, expect, it, vi } from "vitest";
import { backoffDelayMs, retryWithBackoff } from "./rpc-retry";

describe("backoffDelayMs — exponential backoff with full jitter", () => {
  it("scales the cap exponentially with retryIndex before jitter is applied", () => {
    // Fix random() at 1 (exclusive upper bound) to read the cap itself.
    const random = () => 1 - Number.EPSILON;
    expect(backoffDelayMs(1, 100, 10_000, random)).toBeCloseTo(100, 1); // 100 * 2^0
    expect(backoffDelayMs(2, 100, 10_000, random)).toBeCloseTo(200, 1); // 100 * 2^1
    expect(backoffDelayMs(3, 100, 10_000, random)).toBeCloseTo(400, 1); // 100 * 2^2
    expect(backoffDelayMs(4, 100, 10_000, random)).toBeCloseTo(800, 1); // 100 * 2^3
  });

  it("caps the pre-jitter delay at maxDelayMs", () => {
    const random = () => 1 - Number.EPSILON;
    // 2^10 * 100 = 102400, far past a 5000ms cap.
    expect(backoffDelayMs(10, 100, 5000, random)).toBeCloseTo(5000, 1);
  });

  it("applies full jitter: delay is uniformly within [0, cap)", () => {
    expect(backoffDelayMs(3, 100, 10_000, () => 0)).toBe(0);
    expect(backoffDelayMs(3, 100, 10_000, () => 0.5)).toBeCloseTo(200, 1); // 0.5 * 400
  });

  it("defaults to Math.random when no random source is injected", () => {
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      expect(backoffDelayMs(1, 100, 10_000)).toBeCloseTo(50, 1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("retryWithBackoff", () => {
  let instantSleep: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    instantSleep = vi.fn().mockResolvedValue(undefined);
  });

  it("resolves on the first successful call without sleeping", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retryWithBackoff(fn, { attempts: 3, sleep: instantSleep });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(instantSleep).not.toHaveBeenCalled();
  });

  it("retries on failure and resolves once a later attempt succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("ok");
    const result = await retryWithBackoff(fn, { attempts: 3, sleep: instantSleep });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("rejects with the last error once all attempts are exhausted", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(new Error("second"))
      .mockRejectedValueOnce(new Error("third"));
    await expect(retryWithBackoff(fn, { attempts: 3, sleep: instantSleep })).rejects.toThrow(
      "third",
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("never retries when attempts is 1 (fails on the first error)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("nope"));
    await expect(retryWithBackoff(fn, { attempts: 1, sleep: instantSleep })).rejects.toThrow(
      "nope",
    );
    expect(fn).toHaveBeenCalledTimes(1);
    expect(instantSleep).not.toHaveBeenCalled();
  });

  it("throws RangeError for attempts < 1 without calling fn", async () => {
    const fn = vi.fn();
    await expect(retryWithBackoff(fn, { attempts: 0 })).rejects.toBeInstanceOf(RangeError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("stops retrying immediately when isRetryable returns false", async () => {
    class PermanentError extends Error {}
    const fn = vi.fn().mockRejectedValue(new PermanentError("bad input"));
    await expect(
      retryWithBackoff(fn, {
        attempts: 5,
        sleep: instantSleep,
        isRetryable: (err) => !(err instanceof PermanentError),
      }),
    ).rejects.toBeInstanceOf(PermanentError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("sleeps between attempts using the backoff curve (base doubling, capped, jittered)", async () => {
    const delays: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      delays.push(ms);
    });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("1"))
      .mockRejectedValueOnce(new Error("2"))
      .mockResolvedValueOnce("ok");
    await retryWithBackoff(fn, {
      attempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 10_000,
      sleep,
      random: () => 1 - Number.EPSILON, // read the cap directly
    });
    expect(delays[0]).toBeCloseTo(100, 1); // before retry 1: 100 * 2^0
    expect(delays[1]).toBeCloseTo(200, 1); // before retry 2: 100 * 2^1
  });

  it("uses default baseDelayMs/maxDelayMs when not provided", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce("ok");
    await retryWithBackoff(fn, { attempts: 2, sleep: instantSleep });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
