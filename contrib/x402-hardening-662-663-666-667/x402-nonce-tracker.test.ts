// Issue #666 — the same nonce reused across two different resources.
// Replay-window contract: see #407.

import { describe, expect, it } from "vitest";
import { createNonceTracker } from "./x402-nonce-tracker.js";

const NONCE = "a".repeat(32);

describe("createNonceTracker — session-global scope", () => {
  it("accepts a fresh nonce", () => {
    expect(createNonceTracker().claim(NONCE, "https://a.example/x")).toBe(true);
  });

  it("rejects the same nonce on the same resource", () => {
    const t = createNonceTracker();
    t.claim(NONCE, "https://a.example/x");
    expect(t.claim(NONCE, "https://a.example/x")).toBe(false);
  });

  it("rejects the same nonce reused on a DIFFERENT resource", () => {
    // A per-resource cache would call this fresh and miss the replay.
    const t = createNonceTracker();
    expect(t.claim(NONCE, "https://a.example/x")).toBe(true);
    expect(t.claim(NONCE, "https://b.example/y")).toBe(false);
  });

  it("keeps distinct nonces independent across resources", () => {
    const t = createNonceTracker();
    expect(t.claim("1".repeat(32), "https://a.example/x")).toBe(true);
    expect(t.claim("2".repeat(32), "https://b.example/y")).toBe(true);
  });

  it("does not share state between sessions", () => {
    createNonceTracker().claim(NONCE, "https://a.example/x");
    expect(createNonceTracker().claim(NONCE, "https://a.example/x")).toBe(true);
  });
});
