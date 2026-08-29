import { describe, expect, it } from "vitest";
import { renderCleanupPlan, type CleanupPlan } from "./cleanup-plan-viewer";

describe("renderCleanupPlan", () => {
  it("marks each blocker as resolved or outstanding", () => {
    const plan: CleanupPlan = {
      title: "Sample plan",
      blockers: [
        { id: "b1", description: "First step", resolved: true },
        { id: "b2", description: "Second step", resolved: false },
      ],
    };

    const output = renderCleanupPlan(plan);
    expect(output).toContain("1. [RESOLVED] First step (b1)");
    expect(output).toContain("2. [OUTSTANDING] Second step (b2)");
  });

  it("numbers steps in the given order starting at 1", () => {
    const plan: CleanupPlan = {
      title: "Sample plan",
      blockers: [
        { id: "b1", description: "A", resolved: true },
        { id: "b2", description: "B", resolved: true },
        { id: "b3", description: "C", resolved: false },
      ],
    };

    const lines = renderCleanupPlan(plan).split("\n");
    expect(lines).toContain("1. [RESOLVED] A (b1)");
    expect(lines).toContain("2. [RESOLVED] B (b2)");
    expect(lines).toContain("3. [OUTSTANDING] C (b3)");
  });

  it("prints a clear all-clear message for a plan with zero blockers", () => {
    const output = renderCleanupPlan({ title: "Empty plan", blockers: [] });
    expect(output).toBe("Empty plan\n\nAll clear — no blockers remaining.");
    expect(output).not.toContain("RESOLVED");
    expect(output).not.toContain("OUTSTANDING");
  });

  it("includes the plan title as a heading", () => {
    const output = renderCleanupPlan({
      title: "My cleanup plan",
      blockers: [{ id: "b1", description: "Step", resolved: false }],
    });
    expect(output.startsWith("My cleanup plan")).toBe(true);
  });
});
