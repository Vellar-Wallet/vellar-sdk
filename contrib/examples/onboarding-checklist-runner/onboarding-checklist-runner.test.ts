import { describe, expect, it } from "vitest";
import { buildMockChecklist, runOnboardingChecklist, type OnboardingStep } from "./onboarding-checklist-runner";

describe("runOnboardingChecklist", () => {
  it("completes all four steps of the standard mock checklist in order", async () => {
    const result = await runOnboardingChecklist(buildMockChecklist());
    expect(result.completed).toEqual(["create-wallet", "fund-account", "verify-balance", "attach-policy"]);
    expect(result.remaining).toEqual([]);
  });

  it("stops at the first failing step, reporting it and everything after as remaining", async () => {
    const steps: OnboardingStep[] = [
      { id: "step-1", description: "ok", async run() {} },
      { id: "step-2", description: "fails", async run() { throw new Error("boom"); } },
      { id: "step-3", description: "never reached", async run() {} },
    ];

    const result = await runOnboardingChecklist(steps);
    expect(result.completed).toEqual(["step-1"]);
    expect(result.remaining).toEqual(["step-2", "step-3"]);
  });

  it("runs steps in the given order, not concurrently", async () => {
    const order: string[] = [];
    const steps: OnboardingStep[] = [
      { id: "a", description: "", async run() { order.push("a"); } },
      { id: "b", description: "", async run() { order.push("b"); } },
    ];
    await runOnboardingChecklist(steps);
    expect(order).toEqual(["a", "b"]);
  });

  it("returns an empty result for an empty checklist", async () => {
    expect(await runOnboardingChecklist([])).toEqual({ completed: [], remaining: [] });
  });
});

describe("buildMockChecklist", () => {
  it("includes at least four distinct steps", () => {
    const steps = buildMockChecklist();
    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
  });
});
