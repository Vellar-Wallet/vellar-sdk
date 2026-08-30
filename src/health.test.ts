import { describe, expect, it } from "vitest";
import { isReachable } from "./health";

describe("isReachable", () => {
  it("reports reachable with a rounded latency on success", async () => {
    const result = await isReachable("https://rpc.example.com", {
      ping: async () => undefined,
    });
    expect(result.reachable).toBe(true);
    if (result.reachable) {
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(result.latencyMs)).toBe(true);
    }
  });

  it("reports unreachable on a simulated downstream failure", async () => {
    const result = await isReachable("https://rpc.example.com", {
      ping: async () => {
        throw new Error("connection refused");
      },
    });
    expect(result.reachable).toBe(false);
    if (!result.reachable) expect(result.error).toContain("connection refused");
  });

  it("reports unreachable when the endpoint never answers within the timeout", async () => {
    const result = await isReachable("https://rpc.example.com", {
      timeoutMs: 20,
      ping: () => new Promise(() => {}), // never resolves
    });
    expect(result.reachable).toBe(false);
    if (!result.reachable) expect(result.error).toMatch(/timed out/i);
  });

  it("uses the injected clock to measure latency", async () => {
    const timestamps = [100, 115]; // bump: 15ms elapsed on a healthy ping
    let i = 0;
    const result = await isReachable("https://rpc.example.com", {
      now: () => timestamps[i++] ?? 100,
      ping: async () => undefined,
    });
    expect(result.reachable).toBe(true);
    if (result.reachable) expect(result.latencyMs).toBe(15);
  });
});
