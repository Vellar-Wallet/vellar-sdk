import { describe, expect, it } from "vitest";
import {
  ChallengeTracker,
  PasskeyAssertionExpiredError,
  PasskeyAssertionReplayedError,
} from "./passkey-challenge-tracker";

describe("ChallengeTracker", () => {
  const FIVE_MIN_MS = 5 * 60 * 1000;

  it("consumes a freshly-registered challenge without throwing", () => {
    const tracker = new ChallengeTracker();
    tracker.register("chal-1");
    expect(() => tracker.consume("chal-1")).not.toThrow();
  });

  it("throws PasskeyAssertionReplayedError on a second consume of the same challenge", () => {
    const tracker = new ChallengeTracker();
    tracker.register("chal-1");
    tracker.consume("chal-1");
    expect(() => tracker.consume("chal-1")).toThrow(PasskeyAssertionReplayedError);
  });

  it("throws PasskeyAssertionExpiredError past maxAgeMs, with the expected fields", () => {
    let now = new Date("2026-07-16T10:00:00.000Z");
    const tracker = new ChallengeTracker({ maxAgeMs: FIVE_MIN_MS, now: () => now });
    tracker.register("chal-1");

    now = new Date("2026-07-16T10:05:01.000Z"); // 5m1s later
    let caught: unknown;
    try {
      tracker.consume("chal-1");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PasskeyAssertionExpiredError);
    const err = caught as PasskeyAssertionExpiredError;
    expect(err.challenge).toBe("chal-1");
    expect(err.issuedAt).toEqual(new Date("2026-07-16T10:00:00.000Z"));
    expect(err.maxAgeMs).toBe(FIVE_MIN_MS);
  });

  it("accepts a challenge consumed exactly at the boundary (ageMs > maxAgeMs, not >=)", () => {
    let now = new Date("2026-07-16T10:00:00.000Z");
    const tracker = new ChallengeTracker({ maxAgeMs: FIVE_MIN_MS, now: () => now });
    tracker.register("chal-1");
    now = new Date("2026-07-16T10:05:00.000Z"); // exactly 5m later
    expect(() => tracker.consume("chal-1")).not.toThrow();
  });

  it("throws a plain Error for a challenge that was never registered", () => {
    const tracker = new ChallengeTracker();
    expect(() => tracker.consume("never-registered")).toThrow(/unknown/i);
  });

  it("re-registering a challenge clears its prior consumed state", () => {
    const tracker = new ChallengeTracker();
    tracker.register("chal-1");
    tracker.consume("chal-1");
    expect(() => tracker.consume("chal-1")).toThrow(PasskeyAssertionReplayedError);

    tracker.register("chal-1"); // e.g. the backend reissued the same string
    expect(() => tracker.consume("chal-1")).not.toThrow();
  });

  it("tracks multiple challenges independently", () => {
    const tracker = new ChallengeTracker();
    tracker.register("chal-a");
    tracker.register("chal-b");
    tracker.consume("chal-a");
    expect(() => tracker.consume("chal-a")).toThrow(PasskeyAssertionReplayedError);
    expect(() => tracker.consume("chal-b")).not.toThrow();
  });

  it("prunes expired entries lazily so long-running processes don't leak memory", () => {
    let now = new Date("2026-07-16T10:00:00.000Z");
    const tracker = new ChallengeTracker({ maxAgeMs: FIVE_MIN_MS, now: () => now });
    tracker.register("stale-challenge");

    now = new Date("2026-07-16T11:00:00.000Z"); // 1h later, well past maxAgeMs
    tracker.register("fresh-challenge"); // triggers a prune pass

    // The pruned challenge is gone entirely — treated as never registered,
    // not merely expired (both throw, but this exercises the prune path).
    expect(() => tracker.consume("stale-challenge")).toThrow(/unknown/i);
    expect(() => tracker.consume("fresh-challenge")).not.toThrow();
  });
});
