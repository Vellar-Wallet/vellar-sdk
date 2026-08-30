import { describe, expect, it } from "vitest";
import { runHealthAggregator, formatReport, type MockSession } from "./wallet-health-aggregator";

describe("runHealthAggregator", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");
  const validSession: MockSession = { connected: true, expiresAt: "2026-07-01T00:00:00.000Z" };

  it("reports healthy when all three checks pass", async () => {
    const report = await runHealthAggregator({
      session: validSession,
      pingBackend: async () => true,
      pingRpc: async () => true,
      now,
    });
    expect(report.status).toBe("healthy");
    expect(report.checks).toHaveLength(3);
    expect(report.checks.every((c) => c.passed)).toBe(true);
  });

  it("reports degraded when the session is missing", async () => {
    const report = await runHealthAggregator({
      session: null,
      pingBackend: async () => true,
      pingRpc: async () => true,
      now,
    });
    expect(report.status).toBe("degraded");
    const sessionCheck = report.checks.find((c) => c.name === "Session valid");
    expect(sessionCheck?.passed).toBe(false);
    expect(sessionCheck?.reason).toMatch(/No active session/);
  });

  it("reports degraded when the session is not connected", async () => {
    const report = await runHealthAggregator({
      session: { connected: false, expiresAt: "2026-07-01T00:00:00.000Z" },
      pingBackend: async () => true,
      pingRpc: async () => true,
      now,
    });
    expect(report.status).toBe("degraded");
  });

  it("reports degraded when the session is expired", async () => {
    const report = await runHealthAggregator({
      session: { connected: true, expiresAt: "2026-06-01T00:00:00.000Z" },
      pingBackend: async () => true,
      pingRpc: async () => true,
      now,
    });
    expect(report.status).toBe("degraded");
  });

  it("reports degraded when the backend is unreachable", async () => {
    const report = await runHealthAggregator({
      session: validSession,
      pingBackend: async () => false,
      pingRpc: async () => true,
      now,
    });
    expect(report.status).toBe("degraded");
    const backendCheck = report.checks.find((c) => c.name === "Backend reachable");
    expect(backendCheck?.passed).toBe(false);
  });

  it("reports degraded when the RPC ping throws", async () => {
    const report = await runHealthAggregator({
      session: validSession,
      pingBackend: async () => true,
      pingRpc: async () => {
        throw new Error("connection reset");
      },
      now,
    });
    expect(report.status).toBe("degraded");
    const rpcCheck = report.checks.find((c) => c.name === "RPC reachable");
    expect(rpcCheck?.reason).toMatch(/connection reset/);
  });

  it("reports degraded when a single check out of three fails", async () => {
    const report = await runHealthAggregator({
      session: validSession,
      pingBackend: async () => true,
      pingRpc: async () => false,
      now,
    });
    expect(report.status).toBe("degraded");
    expect(report.checks.filter((c) => c.passed)).toHaveLength(2);
  });
});

describe("formatReport", () => {
  it("renders passing and failing checks with reasons", async () => {
    const report = await runHealthAggregator({
      session: null,
      pingBackend: async () => true,
      pingRpc: async () => true,
      now: new Date("2026-06-15T12:00:00.000Z"),
    });
    const text = formatReport(report);
    expect(text).toContain("Overall status: DEGRADED");
    expect(text).toContain("✗ Session valid — No active session");
    expect(text).toContain("✓ Backend reachable");
  });
});
