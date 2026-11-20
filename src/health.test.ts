import { describe, expect, it } from "vitest";
import {
  compareCommit,
  isReachable,
  parseHealthResponse,
  type HealthResponse,
} from "./health";

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

describe("parseHealthResponse", () => {
  it("parses a complete healthy response with unverifiableEntries omitted", () => {
    const raw = {
      status: "ok",
      commit: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
      version: "1.4.2",
      network: "base-sepolia",
      uptimeSeconds: 12345,
      // unverifiableEntries intentionally omitted: documented as sometimes absent
    };
    const parsed = parseHealthResponse(raw);
    expect(parsed.status).toBe("ok");
    expect(parsed.commit).toBe("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0");
    expect(parsed.version).toBe("1.4.2");
    expect(parsed.network).toBe("base-sepolia");
    expect(parsed.uptimeSeconds).toBe(12345);
    expect(parsed.unverifiableEntries).toBe(0);
  });

  it("is resilient to several documented-optional fields being omitted", () => {
    const raw = {
      status: "ok",
      commit: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      // version, network, uptimeSeconds, unverifiableEntries all omitted
    };
    const parsed = parseHealthResponse(raw);
    expect(parsed.status).toBe("ok");
    expect(parsed.commit).toBe("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
    expect(parsed.unverifiableEntries).toBe(0);
  });

  it("throws a descriptive error when a guaranteed field is missing", () => {
    const raw = {
      status: "ok",
      version: "1.4.2",
      network: "base-sepolia",
      uptimeSeconds: 10,
      unverifiableEntries: 0,
    };
    expect(() => parseHealthResponse(raw)).toThrow(/commit/i);
  });
});

describe("compareCommit", () => {
  const health: HealthResponse = {
    status: "ok",
    commit: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    version: "1.4.2",
    network: "base-sepolia",
    uptimeSeconds: 100,
    unverifiableEntries: 0,
  };

  it("reports a match when the live commit equals the expected commit", () => {
    const result = compareCommit(health, "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0");
    expect(result.matches).toBe(true);
    expect(result.actual).toBe("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0");
    expect(result.expected).toBe("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0");
  });

  it("clearly reports a mismatch rather than silently ignoring it", () => {
    const result = compareCommit(health, "0000000000000000000000000000000000000000");
    expect(result.matches).toBe(false);
    expect(result.actual).toBe("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0");
    expect(result.expected).toBe("0000000000000000000000000000000000000000");
  });
});
