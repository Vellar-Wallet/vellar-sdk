import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PasskeyKitAuthRateLimiter, RateLimitError } from "./passkeykit-rate-limit";

describe("Issue #263 — PasskeyKit Auth Rate Limiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows attempts under the limit", () => {
    const limiter = new PasskeyKitAuthRateLimiter({ maxAttempts: 3, windowMs: 1000 });
    expect(() => limiter.guard()).not.toThrow();
    expect(() => limiter.guard()).not.toThrow();
    expect(() => limiter.guard()).not.toThrow();
  });

  it("rejects attempts over the limit", () => {
    const limiter = new PasskeyKitAuthRateLimiter({ maxAttempts: 2, windowMs: 1000 });
    limiter.guard();
    limiter.guard();
    expect(() => limiter.guard()).toThrow(RateLimitError);
    expect(() => limiter.guard()).toThrow("Too many authentication attempts");
  });

  it("allows attempts again after the window expires", () => {
    const limiter = new PasskeyKitAuthRateLimiter({ maxAttempts: 1, windowMs: 1000 });
    limiter.guard();
    expect(() => limiter.guard()).toThrow(RateLimitError);

    vi.advanceTimersByTime(1001);
    expect(() => limiter.guard()).not.toThrow();
  });

  it("resets limits when explicitly requested", () => {
    const limiter = new PasskeyKitAuthRateLimiter({ maxAttempts: 1, windowMs: 1000 });
    limiter.guard();
    expect(() => limiter.guard()).toThrow(RateLimitError);

    limiter.reset();
    expect(() => limiter.guard()).not.toThrow();
  });
});
