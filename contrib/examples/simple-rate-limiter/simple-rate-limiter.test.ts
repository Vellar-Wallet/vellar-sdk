import { describe, expect, it } from "vitest";
import { SimpleRateLimiter } from "./simple-rate-limiter";

describe("SimpleRateLimiter", () => {
  it("allows calls up to the limit within a window, then rejects", () => {
    let now = 0;
    const limiter = new SimpleRateLimiter(3, 1000, () => now);

    expect(limiter.isAllowed("user-1")).toBe(true);
    expect(limiter.isAllowed("user-1")).toBe(true);
    expect(limiter.isAllowed("user-1")).toBe(true);
    expect(limiter.isAllowed("user-1")).toBe(false); // 4th call within the window
  });

  it("tracks separate keys independently", () => {
    let now = 0;
    const limiter = new SimpleRateLimiter(1, 1000, () => now);

    expect(limiter.isAllowed("user-1")).toBe(true);
    expect(limiter.isAllowed("user-1")).toBe(false);
    expect(limiter.isAllowed("user-2")).toBe(true); // different key, own window
  });

  it("resets the count once a new window begins", () => {
    let now = 0;
    const limiter = new SimpleRateLimiter(2, 1000, () => now);

    expect(limiter.isAllowed("user-1")).toBe(true);
    expect(limiter.isAllowed("user-1")).toBe(true);
    expect(limiter.isAllowed("user-1")).toBe(false);

    now = 1000; // window elapses
    expect(limiter.isAllowed("user-1")).toBe(true);
  });
});
