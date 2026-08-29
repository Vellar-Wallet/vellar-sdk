import { describe, expect, it } from "vitest";
import { formatAuditTrail, type SignerChangeEvent } from "./signer-audit-trail";

describe("formatAuditTrail", () => {
  it("renders each entry with action, key type, and timestamp", () => {
    const events: SignerChangeEvent[] = [
      { action: "add", keyType: "passkey", signerId: "device-1", timestamp: "2026-01-01T00:00:00Z" },
    ];
    expect(formatAuditTrail(events)).toBe("[2026-01-01T00:00:00Z] Added passkey signer (device-1)");
  });

  it("labels update and remove actions distinctly from add", () => {
    const events: SignerChangeEvent[] = [
      { action: "update", keyType: "policy-contract", signerId: "policy-1", timestamp: "2026-01-01T00:00:00Z" },
      { action: "remove", keyType: "ed25519", signerId: "key-1", timestamp: "2026-01-02T00:00:00Z" },
    ];
    const trail = formatAuditTrail(events);
    expect(trail).toContain("Updated policy-contract signer (policy-1)");
    expect(trail).toContain("Removed ed25519 signer (key-1)");
  });

  it("orders entries oldest first regardless of input order", () => {
    const events: SignerChangeEvent[] = [
      { action: "remove", keyType: "ed25519", signerId: "b", timestamp: "2026-03-01T00:00:00Z" },
      { action: "add", keyType: "passkey", signerId: "a", timestamp: "2026-01-01T00:00:00Z" },
      { action: "update", keyType: "policy-contract", signerId: "c", timestamp: "2026-02-01T00:00:00Z" },
    ];

    const lines = formatAuditTrail(events).split("\n");
    expect(lines[0]).toContain("(a)");
    expect(lines[1]).toContain("(c)");
    expect(lines[2]).toContain("(b)");
  });

  it("does not mutate the input array", () => {
    const events: SignerChangeEvent[] = [
      { action: "remove", keyType: "ed25519", signerId: "b", timestamp: "2026-03-01T00:00:00Z" },
      { action: "add", keyType: "passkey", signerId: "a", timestamp: "2026-01-01T00:00:00Z" },
    ];
    const original = [...events];
    formatAuditTrail(events);
    expect(events).toEqual(original);
  });

  it("returns an empty string for an empty event list", () => {
    expect(formatAuditTrail([])).toBe("");
  });
});
