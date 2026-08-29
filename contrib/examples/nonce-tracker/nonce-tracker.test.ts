import { describe, expect, it } from "vitest";
import { NonceTracker } from "./nonce-tracker";

describe("NonceTracker", () => {
  it("accepts a fresh nonce", () => {
    const tracker = new NonceTracker();
    expect(tracker.checkAndConsume("GALICE", "n1")).toBe(true);
  });

  it("rejects a repeated nonce for the same account", () => {
    const tracker = new NonceTracker();
    tracker.checkAndConsume("GALICE", "n1");
    expect(tracker.checkAndConsume("GALICE", "n1")).toBe(false);
  });

  it("tracks nonces independently per account", () => {
    const tracker = new NonceTracker();
    tracker.checkAndConsume("GALICE", "n1");
    expect(tracker.checkAndConsume("GBOB", "n1")).toBe(true);
  });

  it("accepts a different nonce for an account that already used one", () => {
    const tracker = new NonceTracker();
    tracker.checkAndConsume("GALICE", "n1");
    expect(tracker.checkAndConsume("GALICE", "n2")).toBe(true);
  });
});
