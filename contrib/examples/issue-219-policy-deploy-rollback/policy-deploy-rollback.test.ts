import { describe, expect, it, vi } from "vitest";
import {
  deployPolicyWithRollback,
  PolicyDeploymentRollbackError,
  runDeploymentWithRollback,
  type DeploymentLogger,
  type DeploymentStep,
  type PolicyDeployApi,
} from "./policy-deploy-rollback";

function recordingLogger() {
  const info: string[] = [];
  const warn: string[] = [];
  const logger: DeploymentLogger = {
    info: (m) => info.push(m),
    warn: (m) => warn.push(m),
  };
  return { logger, info, warn };
}

function stubApi(overrides: Partial<PolicyDeployApi> = {}): PolicyDeployApi {
  return {
    generate: vi.fn(async () => ({ id: "pol_1", status: "draft" })),
    simulate: vi.fn(async () => ({ ok: true })),
    deployInstance: vi.fn(async () => ({ contractId: "CINSTANCE" })),
    recordDeployment: vi.fn(async () => ({ id: "pol_1", status: "active" })),
    deletePolicy: vi.fn(async () => {}),
    revokeInstance: vi.fn(async () => {}),
    ...overrides,
  };
}

const input = {
  definition: { name: "daily-limit" },
  wallet: "CWALLET",
  txHash: "abc123",
};

describe("deployPolicyWithRollback", () => {
  it("runs the full sequence and returns the recorded policy on success", async () => {
    const api = stubApi();

    const policy = await deployPolicyWithRollback(api, input);

    expect(policy).toEqual({ id: "pol_1", status: "active" });
    expect(api.generate).toHaveBeenCalledTimes(1);
    expect(api.simulate).toHaveBeenCalledWith("pol_1", "CWALLET");
    expect(api.deployInstance).toHaveBeenCalledWith("pol_1", "CWALLET");
    expect(api.recordDeployment).toHaveBeenCalledWith("pol_1", "abc123", "CINSTANCE");
    // Nothing failed, so nothing is undone.
    expect(api.deletePolicy).not.toHaveBeenCalled();
    expect(api.revokeInstance).not.toHaveBeenCalled();
  });

  it("rolls back the instance deploy and the generate when recordDeployment fails", async () => {
    const api = stubApi({
      recordDeployment: vi.fn(async () => {
        throw new Error("gateway 503");
      }),
    });

    await expect(deployPolicyWithRollback(api, input)).rejects.toThrow(
      PolicyDeploymentRollbackError,
    );

    expect(api.revokeInstance).toHaveBeenCalledWith("pol_1", "CINSTANCE");
    expect(api.deletePolicy).toHaveBeenCalledWith("pol_1");
  });

  it("compensates in reverse order so the instance is revoked before the policy is deleted", async () => {
    const order: string[] = [];
    const api = stubApi({
      revokeInstance: vi.fn(async () => {
        order.push("revokeInstance");
      }),
      deletePolicy: vi.fn(async () => {
        order.push("deletePolicy");
      }),
      recordDeployment: vi.fn(async () => {
        throw new Error("gateway 503");
      }),
    });

    await expect(deployPolicyWithRollback(api, input)).rejects.toThrow();
    expect(order).toEqual(["revokeInstance", "deletePolicy"]);
  });

  it("only undoes the steps that actually completed", async () => {
    const api = stubApi({
      deployInstance: vi.fn(async () => {
        throw new Error("sponsor account drained");
      }),
    });

    await expect(deployPolicyWithRollback(api, input)).rejects.toThrow(/sponsor account drained/);

    // deployInstance never completed, so there is no instance to revoke.
    expect(api.revokeInstance).not.toHaveBeenCalled();
    expect(api.deletePolicy).toHaveBeenCalledWith("pol_1");
  });

  it("rolls back a rejected simulation without revoking a nonexistent instance", async () => {
    const api = stubApi({
      simulate: vi.fn(async () => ({ ok: false, reason: "limit exceeds wallet balance" })),
    });

    const err = await deployPolicyWithRollback(api, input).catch((e) => e);

    expect(err).toBeInstanceOf(PolicyDeploymentRollbackError);
    expect(err.cause.message).toMatch(/limit exceeds wallet balance/);
    expect(err.completedSteps).toEqual(["generate"]);
    expect(api.deployInstance).not.toHaveBeenCalled();
    expect(api.revokeInstance).not.toHaveBeenCalled();
    expect(api.deletePolicy).toHaveBeenCalledWith("pol_1");
  });

  it("reports the original cause and a fully-rolled-back flag", async () => {
    const api = stubApi({
      recordDeployment: vi.fn(async () => {
        throw new Error("gateway 503");
      }),
    });

    const err = await deployPolicyWithRollback(api, input).catch((e) => e);

    expect(err).toBeInstanceOf(PolicyDeploymentRollbackError);
    expect(err.cause.message).toBe("gateway 503");
    expect(err.completedSteps).toEqual(["generate", "simulate", "deployInstance"]);
    expect(err.fullyRolledBack).toBe(true);
    expect(err.rollback).toEqual([
      { step: "deployInstance", ok: true },
      { step: "generate", ok: true },
    ]);
  });

  it("keeps unwinding when a compensation itself fails, without masking the cause", async () => {
    const api = stubApi({
      recordDeployment: vi.fn(async () => {
        throw new Error("gateway 503");
      }),
      revokeInstance: vi.fn(async () => {
        throw new Error("revoke rejected: instance already attached");
      }),
    });

    const err = await deployPolicyWithRollback(api, input).catch((e) => e);

    // Original failure is preserved, not replaced by the rollback failure.
    expect(err.cause.message).toBe("gateway 503");
    expect(err.fullyRolledBack).toBe(false);
    expect(err.rollback).toEqual([
      {
        step: "deployInstance",
        ok: false,
        error: "revoke rejected: instance already attached",
      },
      { step: "generate", ok: true },
    ]);
    // The failed compensation did not abort the remaining one.
    expect(api.deletePolicy).toHaveBeenCalledWith("pol_1");
  });

  it("logs each completed step and every rollback event", async () => {
    const { logger, info, warn } = recordingLogger();
    const api = stubApi({
      recordDeployment: vi.fn(async () => {
        throw new Error("gateway 503");
      }),
    });

    await expect(deployPolicyWithRollback(api, input, { logger })).rejects.toThrow();

    expect(info).toEqual([
      'policy deploy: step "generate" completed',
      'policy deploy: step "simulate" completed',
      'policy deploy: step "deployInstance" completed',
      'policy deploy: rolled back step "deployInstance"',
      'policy deploy: rolled back step "generate"',
    ]);
    expect(warn).toEqual(['policy deploy: step "recordDeployment" failed, rolling back']);
  });

  it("logs a failed rollback at warn level", async () => {
    const { logger, warn } = recordingLogger();
    const api = stubApi({
      recordDeployment: vi.fn(async () => {
        throw new Error("gateway 503");
      }),
      revokeInstance: vi.fn(async () => {
        throw new Error("revoke rejected");
      }),
    });

    await expect(deployPolicyWithRollback(api, input, { logger })).rejects.toThrow();

    expect(warn).toContain('policy deploy: rollback of step "deployInstance" FAILED');
  });
});

describe("runDeploymentWithRollback", () => {
  it("threads state through the steps in order", async () => {
    const steps: DeploymentStep<{ trail: string[] }>[] = [
      { name: "a", run: async (s) => ({ trail: [...s.trail, "a"] }) },
      { name: "b", run: async (s) => ({ trail: [...s.trail, "b"] }) },
    ];

    await expect(runDeploymentWithRollback(steps, { trail: [] })).resolves.toEqual({
      trail: ["a", "b"],
    });
  });

  it("passes each compensation the state as it stood after its own step", async () => {
    const seen: string[] = [];
    const steps: DeploymentStep<{ id?: string }>[] = [
      {
        name: "create",
        run: async () => ({ id: "created-1" }),
        compensate: async (state) => {
          seen.push(state.id!);
        },
      },
      {
        name: "fail",
        run: async () => {
          throw new Error("boom");
        },
      },
    ];

    await expect(runDeploymentWithRollback(steps, {})).rejects.toThrow("boom");
    expect(seen).toEqual(["created-1"]);
  });
});
