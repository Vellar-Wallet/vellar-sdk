import { describe, expect, it, vi } from "vitest";
import { createRestartAwareDiscovery } from "./discovery.js";

describe("discovery durability non-assumption (#874)", () => {
  it("treats a previously known resource as gone after a simulated restart", async () => {
    const beforeRestart = {
      resources: [
        {
          url: "http://127.0.0.1:4021/paid",
          trust: { statsSource: "observed" as const },
        },
      ],
    };
    // Empty catalog after the in-memory facilitator restarts.
    const afterRestart = { resources: [] };
    const fetchDiscovery = vi.fn()
      .mockResolvedValueOnce(beforeRestart)
      .mockResolvedValueOnce(afterRestart);

    const discovery = createRestartAwareDiscovery(fetchDiscovery);
    const first = await discovery.discover();
    expect(discovery.has("http://127.0.0.1:4021/paid")).toBe(true);
    expect(first.durability.verdict).toBe("inconclusive");

    const second = await discovery.discover();
    expect(second.resources).toEqual([]);
    expect(discovery.has("http://127.0.0.1:4021/paid")).toBe(false);
    expect(second.durability.verdict).toBe("inconclusive");
  });

  it("re-checks durability on every call instead of trusting a prior verdict", async () => {
    const fetchDiscovery = vi.fn()
      .mockResolvedValueOnce({
        resources: [{ url: "http://127.0.0.1:4021/paid", trust: { statsSource: "persisted" } }],
      })
      .mockResolvedValueOnce({ resources: [] });

    const discovery = createRestartAwareDiscovery(fetchDiscovery);
    expect((await discovery.discover()).durability.verdict).toBe("durable");
    expect((await discovery.discover()).durability.verdict).toBe("inconclusive");
    expect(fetchDiscovery).toHaveBeenCalledTimes(2);
  });

  it("never merges old entries into a later response", async () => {
    const fetchDiscovery = vi.fn()
      .mockResolvedValueOnce({ resources: [{ url: "http://127.0.0.1:4021/a" }] })
      .mockResolvedValueOnce({ resources: [{ url: "http://127.0.0.1:4021/b" }] });

    const discovery = createRestartAwareDiscovery(fetchDiscovery);
    await discovery.discover();
    const snapshot = await discovery.discover();

    expect(snapshot.resources.map((resource) => resource.url)).toEqual([
      "http://127.0.0.1:4021/b",
    ]);
    expect(discovery.has("http://127.0.0.1:4021/a")).toBe(false);
  });
});
