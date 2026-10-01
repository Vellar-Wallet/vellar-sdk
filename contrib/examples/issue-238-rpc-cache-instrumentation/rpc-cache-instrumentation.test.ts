import { describe, expect, it, vi } from "vitest";
import {
  createInstrumentedCache,
  createInstrumentedCachedFetcher,
} from "./rpc-cache-instrumentation";

describe("createInstrumentedCache", () => {
  it("fires onCacheMiss for a key that was never cached", () => {
    const onCacheMiss = vi.fn();
    const cache = createInstrumentedCache<number>({ ttlMs: 60_000, onCacheMiss });

    const result = cache.get("k1");

    expect(result).toBeUndefined();
    expect(onCacheMiss).toHaveBeenCalledWith("k1");
  });

  it("fires onCacheHit for a key that is cached and not expired", () => {
    const onCacheHit = vi.fn();
    const onCacheMiss = vi.fn();
    const cache = createInstrumentedCache<number>({ ttlMs: 60_000, onCacheHit, onCacheMiss });

    cache.set("k1", 42);
    const result = cache.get("k1");

    expect(result).toBe(42);
    expect(onCacheHit).toHaveBeenCalledWith("k1", 42);
    expect(onCacheMiss).not.toHaveBeenCalled();
  });

  it("fires onCacheMiss (not onCacheHit) for an expired entry", async () => {
    const onCacheHit = vi.fn();
    const onCacheMiss = vi.fn();
    const cache = createInstrumentedCache<number>({ ttlMs: 1, onCacheHit, onCacheMiss });

    cache.set("k1", 42);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const result = cache.get("k1");

    expect(result).toBeUndefined();
    expect(onCacheMiss).toHaveBeenCalledWith("k1");
    expect(onCacheHit).not.toHaveBeenCalled();
  });

  it("evicts an expired entry on access so it does not linger in size()", async () => {
    const cache = createInstrumentedCache<number>({ ttlMs: 1 });
    cache.set("k1", 42);
    await new Promise((resolve) => setTimeout(resolve, 5));

    cache.get("k1");

    expect(cache.size()).toBe(0);
  });

  it("works with no hooks supplied at all", () => {
    const cache = createInstrumentedCache<number>({ ttlMs: 60_000 });
    expect(() => cache.get("k1")).not.toThrow();
    cache.set("k1", 1);
    expect(cache.get("k1")).toBe(1);
  });

  it("propagates an exception thrown from a hook rather than swallowing it", () => {
    const cache = createInstrumentedCache<number>({
      ttlMs: 60_000,
      onCacheMiss: () => {
        throw new Error("telemetry backend down");
      },
    });

    expect(() => cache.get("k1")).toThrow("telemetry backend down");
  });

  it("delete removes an entry so the next get is a miss", () => {
    const onCacheMiss = vi.fn();
    const cache = createInstrumentedCache<number>({ ttlMs: 60_000, onCacheMiss });
    cache.set("k1", 1);
    cache.delete("k1");

    expect(cache.get("k1")).toBeUndefined();
    expect(onCacheMiss).toHaveBeenCalledWith("k1");
  });
});

describe("createInstrumentedCachedFetcher", () => {
  it("calls the fetcher once and serves the cache on subsequent calls", async () => {
    const fetcher = vi.fn(async (key: string) => `value-for-${key}`);
    const onCacheHit = vi.fn();
    const onCacheMiss = vi.fn();
    const cachedFetch = createInstrumentedCachedFetcher(fetcher, {
      ttlMs: 60_000,
      onCacheHit,
      onCacheMiss,
    });

    const first = await cachedFetch("a");
    const second = await cachedFetch("a");

    expect(first).toBe("value-for-a");
    expect(second).toBe("value-for-a");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onCacheMiss).toHaveBeenCalledTimes(1);
    expect(onCacheHit).toHaveBeenCalledTimes(1);
  });
});
