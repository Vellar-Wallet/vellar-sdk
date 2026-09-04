import { describe, expect, it, vi } from "vitest";
import { withTemplateCache, type PolicyClientLike } from "./policy-template-cache";
import type { PolicyDefinition } from "../../../src/types";

const definition: PolicyDefinition = {
  version: "1",
  type: "spending_limit",
  owners: ["CAFK7NMQOT7G2SKMREDUII3EOK4APIY54WIK6CVGY72XWFE76YFRDF67"],
  spendingLimits: { dailyXlm: "100" },
};

function template(title: string) {
  return { type: "spending_limit", title, description: "", enforcement: { kind: "none" as const } };
}

function fakeClient(overrides: Partial<PolicyClientLike> = {}): PolicyClientLike & {
  listTemplates: ReturnType<typeof vi.fn>;
  generate: ReturnType<typeof vi.fn>;
} {
  return {
    listTemplates: vi.fn().mockResolvedValue([template("Spending limit")]),
    generate: vi.fn().mockResolvedValue({ id: "p1", createdAt: "now", status: "generated" }),
    ...overrides,
  };
}

describe("withTemplateCache", () => {
  it("caches listTemplates() — a second call does not re-fetch", async () => {
    const client = fakeClient();
    const cached = withTemplateCache(client);

    const first = await cached.listTemplates();
    const second = await cached.listTemplates();

    expect(second).toEqual(first);
    expect(client.listTemplates).toHaveBeenCalledTimes(1);
  });

  it("de-duplicates concurrent listTemplates() calls into one underlying request", async () => {
    const client = fakeClient();
    const cached = withTemplateCache(client);

    const [a, b, c] = await Promise.all([
      cached.listTemplates(),
      cached.listTemplates(),
      cached.listTemplates(),
    ]);

    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(client.listTemplates).toHaveBeenCalledTimes(1);
  });

  it("generate() invalidates the cache — a subsequent listTemplates() re-fetches", async () => {
    const client = fakeClient({
      listTemplates: vi
        .fn()
        .mockResolvedValueOnce([template("Spending limit")])
        .mockResolvedValueOnce([template("Spending limit (updated)")]),
    });
    const cached = withTemplateCache(client);

    await cached.listTemplates(); // populates the cache
    await cached.generate(definition); // should invalidate it
    const templates = await cached.listTemplates(); // should re-fetch

    expect(templates[0]!.title).toBe("Spending limit (updated)");
    expect(client.listTemplates).toHaveBeenCalledTimes(2);
  });

  it("does not invalidate the cache if generate() fails", async () => {
    const client = fakeClient({ generate: vi.fn().mockRejectedValue(new Error("server error")) });
    const cached = withTemplateCache(client);

    await cached.listTemplates(); // populates the cache
    await expect(cached.generate(definition)).rejects.toThrow("server error");
    await cached.listTemplates(); // should still read the cache

    expect(client.listTemplates).toHaveBeenCalledTimes(1);
  });

  it("refreshTemplates() invalidates and re-fetches even without an intervening generate()", async () => {
    const client = fakeClient({
      listTemplates: vi
        .fn()
        .mockResolvedValueOnce([template("Spending limit")])
        .mockResolvedValueOnce([template("Spending limit v2")]),
    });
    const cached = withTemplateCache(client);

    await cached.listTemplates();
    const refreshed = await cached.refreshTemplates();

    expect(refreshed[0]!.title).toBe("Spending limit v2");
    expect(client.listTemplates).toHaveBeenCalledTimes(2);
  });

  it("fires onCacheInvalidated with reason 'template-update' from generate()", async () => {
    const client = fakeClient();
    const onCacheInvalidated = vi.fn();
    const now = () => new Date("2026-01-01T00:00:00.000Z");
    const cached = withTemplateCache(client, { onCacheInvalidated, now });

    await cached.listTemplates();
    await cached.generate(definition);

    expect(onCacheInvalidated).toHaveBeenCalledWith({
      cache: "templates",
      reason: "template-update",
      at: "2026-01-01T00:00:00.000Z",
    });
  });

  it("fires onCacheInvalidated with reason 'explicit-refresh' from refreshTemplates()", async () => {
    const client = fakeClient();
    const onCacheInvalidated = vi.fn();
    const cached = withTemplateCache(client, { onCacheInvalidated });

    await cached.listTemplates();
    await cached.refreshTemplates();

    expect(onCacheInvalidated.mock.calls[0]![0]).toMatchObject({ reason: "explicit-refresh" });
  });

  it("does not fire onCacheInvalidated when generate() runs before the cache was ever populated", async () => {
    const client = fakeClient();
    const onCacheInvalidated = vi.fn();
    const cached = withTemplateCache(client, { onCacheInvalidated });

    await cached.generate(definition); // no prior listTemplates() call
    expect(onCacheInvalidated).not.toHaveBeenCalled();
  });

  it("exposes the wrapped client via .inner for methods this wrapper doesn't touch", async () => {
    const client = fakeClient();
    const cached = withTemplateCache(client);
    expect(cached.inner).toBe(client);
  });
});
