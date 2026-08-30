import { describe, expect, it } from "vitest";
import { scanVulnerabilities, type VulnerabilityRecord } from "./dependency-scanner";

describe("dependency-scanner (Issue #257)", () => {
  const sampleVulnerabilities: VulnerabilityRecord[] = [
    { id: "GHSA-1", name: "safe-pkg", severity: "low", title: "Minor issue" },
    { id: "GHSA-2", name: "warn-pkg", severity: "moderate", title: "Moderate issue" },
    { id: "GHSA-3", name: "bad-pkg", severity: "high", title: "High severity finding" },
    { id: "GHSA-4", name: "crit-pkg", severity: "critical", title: "Remote code execution" },
  ];

  it("passes when no high or critical vulnerabilities exist", () => {
    const res = scanVulnerabilities(sampleVulnerabilities.slice(0, 2), { failSeverity: "high" });
    expect(res.passed).toBe(true);
    expect(res.failingCount).toBe(0);
  });

  it("fails when high or critical vulnerabilities are present", () => {
    const res = scanVulnerabilities(sampleVulnerabilities, { failSeverity: "high" });
    expect(res.passed).toBe(false);
    expect(res.failingCount).toBe(2);
    expect(res.failing.map((f) => f.id)).toEqual(["GHSA-3", "GHSA-4"]);
  });

  it("permits active documented exceptions for accepted risks", () => {
    const res = scanVulnerabilities(sampleVulnerabilities, {
      failSeverity: "high",
      exceptions: [
        { id: "GHSA-3", name: "bad-pkg", reason: "Dev-only tool, safe in production" },
        { id: "GHSA-4", name: "crit-pkg", reason: "Mitigated by isolated sandbox" },
      ],
    });
    expect(res.passed).toBe(true);
    expect(res.failingCount).toBe(0);
    expect(res.exemptedCount).toBe(2);
  });

  it("fails if an exception has expired", () => {
    const res = scanVulnerabilities(sampleVulnerabilities, {
      failSeverity: "high",
      now: () => new Date("2026-09-01T00:00:00Z"),
      exceptions: [
        {
          id: "GHSA-3",
          name: "bad-pkg",
          reason: "Temporary waiver",
          expiresAt: "2026-08-01T00:00:00Z", // Expired
        },
      ],
    });
    expect(res.passed).toBe(false);
    expect(res.failingCount).toBe(2);
  });
});
