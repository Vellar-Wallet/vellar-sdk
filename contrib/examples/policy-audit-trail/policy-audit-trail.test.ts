import { describe, expect, it } from "vitest";
import { formatAuditTrail, type PolicyChangeEvent } from "./policy-audit-trail";

describe("formatAuditTrail", () => {
  it("renders each entry with action, policy id, and timestamp", () => {
    const events: PolicyChangeEvent[] = [
      { action: "create", policyId: "policy-1", timestamp: "2026-01-01T00:00:00Z" },
    ];
    expect(formatAuditTrail(events)).toBe("[2026-01-01T00:00:00Z] Created policy (policy-1)");
  });

  it("labels update and remove actions distinctly from create", () => {
    const events: PolicyChangeEvent[] = [
      { action: "update", policyId: "policy-1", timestamp: "2026-01-01T00:00:00Z" },
      { action: "remove", policyId: "policy-2", timestamp: "2026-01-02T00:00:00Z" },
    ];
    const trail = formatAuditTrail(events);
    expect(trail).toContain("Updated policy (policy-1)");
    expect(trail).toContain("Removed policy (policy-2)");
  });

  it("orders entries oldest first regardless of input order", () => {
    const events: PolicyChangeEvent[] = [
      { action: "remove", policyId: "b", timestamp: "2026-03-01T00:00:00Z" },
      { action: "create", policyId: "a", timestamp: "2026-01-01T00:00:00Z" },
      { action: "update", policyId: "c", timestamp: "2026-02-01T00:00:00Z" },
    ];

    const lines = formatAuditTrail(events).split("\n");
    expect(lines[0]).toContain("(a)");
    expect(lines[1]).toContain("(c)");
    expect(lines[2]).toContain("(b)");
  });

  it("does not mutate the input array", () => {
    const events: PolicyChangeEvent[] = [
      { action: "remove", policyId: "b", timestamp: "2026-03-01T00:00:00Z" },
      { action: "create", policyId: "a", timestamp: "2026-01-01T00:00:00Z" },
    ];
    const original = [...events];
    formatAuditTrail(events);
    expect(events).toEqual(original);
  });

  it("returns an empty string for an empty event list", () => {
    expect(formatAuditTrail([])).toBe("");
  });
});
