import { describe, expect, it } from "vitest";
import { buildSessionKeyDashboard, type SessionKeyRecord } from "./session-key-dashboard-source";

describe("buildSessionKeyDashboard", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");

  it("marks a key expiring more than 24h out as active", () => {
    const keys: SessionKeyRecord[] = [{ keyId: "k1", address: "C1", expiresAt: "2026-07-01T00:00:00.000Z" }];
    expect(buildSessionKeyDashboard(keys, now)[0]!.status).toBe("active");
  });

  it("marks a key expiring within 24h as expiring_soon", () => {
    const keys: SessionKeyRecord[] = [{ keyId: "k2", address: "C2", expiresAt: "2026-06-15T20:00:00.000Z" }];
    expect(buildSessionKeyDashboard(keys, now)[0]!.status).toBe("expiring_soon");
  });

  it("marks a key already past its expiry as expired", () => {
    const keys: SessionKeyRecord[] = [{ keyId: "k3", address: "C3", expiresAt: "2026-06-01T00:00:00.000Z" }];
    expect(buildSessionKeyDashboard(keys, now)[0]!.status).toBe("expired");
  });

  it("treats an expiry exactly at now as expired (inclusive boundary)", () => {
    const keys: SessionKeyRecord[] = [{ keyId: "k4", address: "C4", expiresAt: now.toISOString() }];
    expect(buildSessionKeyDashboard(keys, now)[0]!.status).toBe("expired");
  });

  it("preserves keyId and address alongside the computed status", () => {
    const keys: SessionKeyRecord[] = [{ keyId: "k5", address: "C5", expiresAt: "2026-07-01T00:00:00.000Z" }];
    expect(buildSessionKeyDashboard(keys, now)[0]).toEqual({
      keyId: "k5",
      address: "C5",
      expiresAt: "2026-07-01T00:00:00.000Z",
      status: "active",
    });
  });

  it("processes multiple keys independently", () => {
    const keys: SessionKeyRecord[] = [
      { keyId: "active", address: "C1", expiresAt: "2026-07-01T00:00:00.000Z" },
      { keyId: "expired", address: "C2", expiresAt: "2026-06-01T00:00:00.000Z" },
    ];
    const dashboard = buildSessionKeyDashboard(keys, now);
    expect(dashboard.map((e) => e.status)).toEqual(["active", "expired"]);
  });
});
