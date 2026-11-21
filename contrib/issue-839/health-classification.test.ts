import { describe, it, expect } from "vitest";
import { classifyCatalogHealth, classifyHealthResponse } from "./health-classification";

const baseHealth = {
  status: "ok",
  catalogSize: 12,
  reverifyPending: 0,
  channelPool: { available: 50 },
  commit: "abc123",
};

describe("classifyCatalogHealth (#839)", () => {
  it("is healthy when both counters are zero", () => {
    const summary = classifyCatalogHealth({ reverifyPending: 0, unverifiableEntries: 0 });

    expect(summary.state).toBe("healthy");
    expect(summary.issues).toEqual([]);
    expect(summary.guidance).toEqual([]);
  });

  it("classifies only reverifyPending as transiently settling", () => {
    const summary = classifyCatalogHealth({ reverifyPending: 3, unverifiableEntries: 0 });

    expect(summary.state).toBe("settling");
    expect(summary.issues).toEqual(["transiently-settling"]);
    expect(summary.transient).toEqual({ settling: true, pending: 3 });
    expect(summary.permanent).toEqual({ unverifiable: false, count: 0 });
    expect(summary.issues).not.toContain("permanent-unverifiable");
  });

  it("classifies only unverifiableEntries as a permanent issue", () => {
    const summary = classifyCatalogHealth({ reverifyPending: 0, unverifiableEntries: 2 });

    expect(summary.state).toBe("permanent-issue");
    expect(summary.issues).toEqual(["permanent-unverifiable"]);
    expect(summary.permanent).toEqual({ unverifiable: true, count: 2 });
    expect(summary.transient.settling).toBe(false);
    expect(summary.issues).not.toContain("transiently-settling");
  });

  it("surfaces BOTH classifications when both fields are non-zero", () => {
    const summary = classifyCatalogHealth({ reverifyPending: 4, unverifiableEntries: 1 });

    expect(summary.state).toBe("settling-with-permanent-issue");
    expect(summary.issues).toEqual(["transiently-settling", "permanent-unverifiable"]);
    expect(summary.transient.settling).toBe(true);
    expect(summary.permanent.unverifiable).toBe(true);
    expect(summary.guidance).toHaveLength(2);
  });

  it("treats an absent unverifiableEntries as zero, not an error", () => {
    const summary = classifyCatalogHealth({ reverifyPending: 0 });

    expect(summary.state).toBe("healthy");
    expect(summary.permanent.count).toBe(0);
  });

  it("tells the operator to wait for transient and to fix permanent", () => {
    const transient = classifyCatalogHealth({ reverifyPending: 1 }).guidance[0];
    const permanent = classifyCatalogHealth({ reverifyPending: 0, unverifiableEntries: 1 }).guidance[0];

    expect(transient).toMatch(/wait/i);
    expect(permanent).toMatch(/will not fix/i);
  });

  it.each([
    ["negative reverifyPending", { reverifyPending: -1 }],
    ["NaN reverifyPending", { reverifyPending: Number.NaN }],
    ["negative unverifiableEntries", { reverifyPending: 0, unverifiableEntries: -2 }],
  ])("rejects %s", (_name, input) => {
    expect(() => classifyCatalogHealth(input)).toThrow(/Invalid catalog health/);
  });
});

describe("classifyHealthResponse (raw /health body)", () => {
  it("classifies a real-shaped body where unverifiableEntries is absent", () => {
    const summary = classifyHealthResponse({ ...baseHealth, reverifyPending: 2 });

    expect(summary.state).toBe("settling");
    expect(summary.permanent.count).toBe(0);
  });

  it("classifies a body with both fields set", () => {
    const summary = classifyHealthResponse({ ...baseHealth, reverifyPending: 1, unverifiableEntries: 5 });

    expect(summary.issues).toEqual(["transiently-settling", "permanent-unverifiable"]);
  });

  it("still throws when a guaranteed field is missing", () => {
    const { reverifyPending: _omit, ...missing } = baseHealth;

    expect(() => classifyHealthResponse(missing)).toThrow(/reverifyPending/);
  });
});
