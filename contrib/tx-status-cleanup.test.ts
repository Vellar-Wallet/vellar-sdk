import { describe, expect, it } from "vitest";
import {
  cleanupStaleEntries,
  createCachedStatusStore,
  type CacheEntry,
} from "./tx-status-cleanup";

function entry<T>(value: T, ageMs: number, now: number): CacheEntry<T> {
  return { value, createdAt: now - ageMs };
}

describe("cleanupStaleEntries", () => {
  it("removes entries older than maxAgeMs", () => {
    const now = 1_000_000;
    const cache = new Map<string, CacheEntry<string>>([
      ["fresh", entry("a", 100, now)],
      ["stale", entry("b", 200_000, now)],
    ]);
    const cleaned = cleanupStaleEntries(cache, { maxAgeMs: 150_000, now: () => now });
    expect(cleaned.size).toBe(1);
    expect(cleaned.get("fresh")?.value).toBe("a");
    expect(cleaned.has("stale")).toBe(false);
  });

  it("keeps all entries when none are stale", () => {
    const now = 1_000_000;
    const cache = new Map<string, CacheEntry<number>>([
      ["a", entry(1, 10, now)],
      ["b", entry(2, 20, now)],
    ]);
    const cleaned = cleanupStaleEntries(cache, { maxAgeMs: 1000, now: () => now });
    expect(cleaned.size).toBe(2);
  });

  it("returns empty map when all entries are stale", () => {
    const now = 1_000_000;
    const cache = new Map<string, CacheEntry<string>>([
      ["a", entry("x", 500_000, now)],
      ["b", entry("y", 600_000, now)],
    ]);
    const cleaned = cleanupStaleEntries(cache, { maxAgeMs: 100_000, now: () => now });
    expect(cleaned.size).toBe(0);
  });

  it("does not mutate the original map", () => {
    const now = 1_000_000;
    const cache = new Map<string, CacheEntry<string>>([
      ["stale", entry("x", 500_000, now)],
    ]);
    cleanupStaleEntries(cache, { maxAgeMs: 100_000, now: () => now });
    expect(cache.size).toBe(1);
  });

  it("defaults maxAgeMs to 1 hour", () => {
    const now = 3_600_000;
    const cache = new Map<string, CacheEntry<string>>([
      ["at-limit", entry("a", 3_600_000, now)],
      ["just-over", entry("b", 3_600_001, now)],
    ]);
    const cleaned = cleanupStaleEntries(cache, { now: () => now });
    expect(cleaned.size).toBe(1);
    expect(cleaned.has("at-limit")).toBe(true);
  });
});

describe("createCachedStatusStore", () => {
  it("stores and retrieves values", () => {
    const store = createCachedStatusStore<string>({ now: () => 1000 });
    store.set("tx1", "success");
    expect(store.get("tx1")).toBe("success");
    expect(store.size).toBe(1);
  });

  it("returns undefined for missing keys", () => {
    const store = createCachedStatusStore<string>();
    expect(store.get("nonexistent")).toBeUndefined();
  });

  it("cleanup removes only stale entries and returns count", () => {
    let time = 0;
    const store = createCachedStatusStore<string>({
      maxAgeMs: 100_000,
      now: () => time,
    });

    time = 50_000;
    store.set("stale1", "c");
    store.set("stale2", "d");
    time = 200_000;
    store.set("fresh1", "a");
    store.set("fresh2", "b");

    const removed = store.cleanup();
    expect(removed).toBe(2);
    expect(store.size).toBe(2);
    expect(store.get("fresh1")).toBe("a");
    expect(store.get("fresh2")).toBe("b");
    expect(store.get("stale1")).toBeUndefined();
    expect(store.get("stale2")).toBeUndefined();
  });

  it("cleanup returns 0 when nothing is stale", () => {
    const store = createCachedStatusStore<number>({ now: () => 1000 });
    store.set("a", 1);
    expect(store.cleanup()).toBe(0);
    expect(store.size).toBe(1);
  });

  it("entries() exposes the underlying cache", () => {
    const store = createCachedStatusStore<string>({ now: () => 1000 });
    store.set("tx1", "pending");
    const entries = store.entries();
    expect(entries.size).toBe(1);
    expect(entries.get("tx1")?.value).toBe("pending");
  });
});
