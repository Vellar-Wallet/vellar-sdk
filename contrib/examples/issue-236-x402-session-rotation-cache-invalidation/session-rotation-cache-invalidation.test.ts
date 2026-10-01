import { describe, expect, it, vi } from "vitest";
import { createSessionAwareAuthorizationCache } from "./session-rotation-cache-invalidation";

const OLD_KEY = "session-key-v1";
const NEW_KEY = "session-key-v2";

describe("createSessionAwareAuthorizationCache", () => {
  it("serves a cached authorization result before rotation", () => {
    const cache = createSessionAwareAuthorizationCache();
    cache.set("resource-a", { authorized: true, sessionKeyId: OLD_KEY, computedAt: Date.now() });

    expect(cache.get("resource-a")?.authorized).toBe(true);
  });

  it("does not serve a stale authorization computed under a rotated-out key", () => {
    const cache = createSessionAwareAuthorizationCache();
    cache.set("resource-a", { authorized: true, sessionKeyId: OLD_KEY, computedAt: Date.now() });

    cache.invalidateForRotatedKey(OLD_KEY);

    expect(cache.get("resource-a")).toBeUndefined();
  });

  it("only invalidates entries tagged with the rotated key, not other resources under other keys", () => {
    const cache = createSessionAwareAuthorizationCache();
    cache.set("resource-old", { authorized: true, sessionKeyId: OLD_KEY, computedAt: Date.now() });
    cache.set("resource-new", { authorized: true, sessionKeyId: NEW_KEY, computedAt: Date.now() });

    const invalidated = cache.invalidateForRotatedKey(OLD_KEY);

    expect(invalidated).toBe(1);
    expect(cache.get("resource-old")).toBeUndefined();
    expect(cache.get("resource-new")?.sessionKeyId).toBe(NEW_KEY);
  });

  it("a post-rotation call recomputes and caches under the new key", () => {
    const cache = createSessionAwareAuthorizationCache();
    cache.set("resource-a", { authorized: true, sessionKeyId: OLD_KEY, computedAt: Date.now() });
    cache.invalidateForRotatedKey(OLD_KEY);

    // Simulates the consumer's post-rotation re-authorization call.
    const fresh = { authorized: true, sessionKeyId: NEW_KEY, computedAt: Date.now() };
    cache.set("resource-a", fresh);

    expect(cache.get("resource-a")).toEqual(fresh);
  });

  it("emits a debug log entry on rotation-triggered invalidation", () => {
    const debugLog = vi.fn();
    const cache = createSessionAwareAuthorizationCache({ debugLog });
    cache.set("resource-a", { authorized: true, sessionKeyId: OLD_KEY, computedAt: Date.now() });

    cache.invalidateForRotatedKey(OLD_KEY);

    expect(debugLog).toHaveBeenCalledWith(
      "x402: invalidated authorization cache entries after session key rotation",
      { oldSessionKeyId: OLD_KEY, invalidatedCount: 1 },
    );
  });

  it("invalidating a key with no cached entries is a no-op that still logs zero", () => {
    const debugLog = vi.fn();
    const cache = createSessionAwareAuthorizationCache({ debugLog });

    const invalidated = cache.invalidateForRotatedKey("never-used-key");

    expect(invalidated).toBe(0);
    expect(debugLog).toHaveBeenCalledWith(expect.any(String), {
      oldSessionKeyId: "never-used-key",
      invalidatedCount: 0,
    });
  });

  it("works with no debugLog supplied at all", () => {
    const cache = createSessionAwareAuthorizationCache();
    cache.set("resource-a", { authorized: true, sessionKeyId: OLD_KEY, computedAt: Date.now() });

    expect(() => cache.invalidateForRotatedKey(OLD_KEY)).not.toThrow();
  });
});
