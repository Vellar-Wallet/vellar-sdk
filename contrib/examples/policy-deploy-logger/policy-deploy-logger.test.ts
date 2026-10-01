import { describe, expect, it, vi } from "vitest";
import {
  executePolicyDeployment,
  type PolicyDeployStepPayload,
  type PolicyDeployTasks,
} from "./policy-deploy-logger";

describe("policy-deploy-logger (Issue #253)", () => {
  function makeTasks(overrides: Partial<PolicyDeployTasks> = {}): PolicyDeployTasks {
    return {
      deployInstance: vi.fn(async () => ({ contractId: "C123" })),
      attachPolicy: vi.fn(async () => {}),
      recordDeployment: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it("emits started and success events for all 3 deployment steps", async () => {
    const tasks = makeTasks();
    const events: PolicyDeployStepPayload[] = [];

    const result = await executePolicyDeployment(tasks, {
      policyId: "spending-limit-v1",
      onStep: (e) => {
        events.push(e);
      },
    });

    expect(result.contractId).toBe("C123");
    expect(events).toEqual([
      { step: "deploy_instance", outcome: "started", policyId: "spending-limit-v1", contractId: undefined, error: undefined },
      { step: "deploy_instance", outcome: "success", policyId: "spending-limit-v1", contractId: "C123", error: undefined },
      { step: "attach_policy", outcome: "started", policyId: "spending-limit-v1", contractId: "C123", error: undefined },
      { step: "attach_policy", outcome: "success", policyId: "spending-limit-v1", contractId: "C123", error: undefined },
      { step: "record_deployment", outcome: "started", policyId: "spending-limit-v1", contractId: "C123", error: undefined },
      { step: "record_deployment", outcome: "success", policyId: "spending-limit-v1", contractId: "C123", error: undefined },
    ]);
  });

  it("reports failure when attach_policy throws and rethrows the error", async () => {
    const attachErr = new Error("User canceled passkey signature");
    const tasks = makeTasks({
      attachPolicy: vi.fn(async () => {
        throw attachErr;
      }),
    });
    const events: PolicyDeployStepPayload[] = [];

    await expect(
      executePolicyDeployment(tasks, {
        policyId: "policy-abc",
        onStep: (e) => {
          events.push(e);
        },
      }),
    ).rejects.toThrow("User canceled passkey signature");

    const failedEvent = events.find((e) => e.outcome === "failed");
    expect(failedEvent).toEqual({
      step: "attach_policy",
      outcome: "failed",
      policyId: "policy-abc",
      contractId: "C123",
      error: attachErr,
    });
  });
});
