/**
 * Transactional multi-step policy deployment with compensating rollback.
 *
 * Contributed for issue #219: policy deployment issues several sequential API
 * calls (generate -> simulate -> deploy instance -> record deployment) with no
 * rollback path. If a later step fails, the earlier ones stay committed: a
 * generated policy is left orphaned, or an instance contract is deployed and
 * never recorded, so the service and the chain disagree about what exists.
 *
 * This wraps the sequence as a saga. Each step declares how to undo itself, the
 * runner records every step that actually completed, and on failure it runs the
 * recorded compensations in reverse order (LIFO) — the undo for the most recent
 * step runs first, because a later step may depend on an earlier one.
 *
 * Rollback is best-effort by design. A compensation that itself fails must not
 * mask the original error nor abort the remaining compensations, so failures are
 * collected, logged, and surfaced on the thrown error rather than propagated.
 */

export interface DeploymentLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
}

/** Records the outcome of one attempted compensation. */
export interface RollbackOutcome {
  step: string;
  ok: boolean;
  /** Present when the compensation itself failed. */
  error?: string;
}

/**
 * Thrown when a deployment fails partway. Carries the original cause plus a
 * per-step record of what the rollback managed to undo, so a caller can tell
 * "fully rolled back" from "rolled back except the instance deploy".
 */
export class PolicyDeploymentRollbackError extends Error {
  constructor(
    readonly cause: Error,
    /** Steps that had completed before the failure, in execution order. */
    readonly completedSteps: string[],
    readonly rollback: RollbackOutcome[],
  ) {
    super(`policy deployment failed at step "${completedSteps.length + 1}": ${cause.message}`);
    this.name = "PolicyDeploymentRollbackError";
  }

  /** True when every compensation succeeded — no orphaned state remains. */
  get fullyRolledBack(): boolean {
    return this.rollback.every((r) => r.ok);
  }
}

export interface DeploymentStep<TState> {
  name: string;
  run(state: TState): Promise<TState>;
  /**
   * Undo this step. Omit for steps with nothing to undo (a read-only simulate).
   * Receives the state as it stood AFTER the step ran, so it can reach the ids
   * the step produced.
   */
  compensate?(state: TState): Promise<void>;
}

export interface RunDeploymentOptions {
  logger?: DeploymentLogger;
}

const noopLogger: DeploymentLogger = { info: () => {}, warn: () => {} };

/**
 * Runs steps in order. On failure, compensates the completed steps in reverse.
 *
 * The state after each successful step is captured so compensations see exactly
 * the state their own step produced.
 */
export async function runDeploymentWithRollback<TState>(
  steps: DeploymentStep<TState>[],
  initialState: TState,
  options: RunDeploymentOptions = {},
): Promise<TState> {
  const logger = options.logger ?? noopLogger;
  const completed: { step: DeploymentStep<TState>; stateAfter: TState }[] = [];
  let state = initialState;

  for (const step of steps) {
    try {
      state = await step.run(state);
      completed.push({ step, stateAfter: state });
      logger.info(`policy deploy: step "${step.name}" completed`);
    } catch (err) {
      const cause = err instanceof Error ? err : new Error(String(err));
      logger.warn(`policy deploy: step "${step.name}" failed, rolling back`, {
        error: cause.message,
        completedSteps: completed.map((c) => c.step.name),
      });

      const outcomes = await compensate(completed, logger);
      throw new PolicyDeploymentRollbackError(
        cause,
        completed.map((c) => c.step.name),
        outcomes,
      );
    }
  }

  return state;
}

async function compensate<TState>(
  completed: { step: DeploymentStep<TState>; stateAfter: TState }[],
  logger: DeploymentLogger,
): Promise<RollbackOutcome[]> {
  const outcomes: RollbackOutcome[] = [];

  // Reverse order: a later step may depend on an earlier one, so its undo has
  // to run first.
  for (let i = completed.length - 1; i >= 0; i--) {
    const { step, stateAfter } = completed[i]!;
    if (!step.compensate) continue;

    try {
      await step.compensate(stateAfter);
      outcomes.push({ step: step.name, ok: true });
      logger.info(`policy deploy: rolled back step "${step.name}"`);
    } catch (err) {
      // Never let a failed compensation abort the remaining ones or replace the
      // original error — record it and keep unwinding.
      const message = err instanceof Error ? err.message : String(err);
      outcomes.push({ step: step.name, ok: false, error: message });
      logger.warn(`policy deploy: rollback of step "${step.name}" FAILED`, { error: message });
    }
  }

  return outcomes;
}

// --- The concrete policy deployment saga -----------------------------------

export interface PolicyDefinition {
  name: string;
  [key: string]: unknown;
}

export interface GeneratedPolicy {
  id: string;
  status: string;
}

export interface SimulateResult {
  ok: boolean;
  reason?: string;
}

/** The subset of the policy client this saga drives. */
export interface PolicyDeployApi {
  generate(definition: PolicyDefinition): Promise<GeneratedPolicy>;
  simulate(policyId: string, wallet: string): Promise<SimulateResult>;
  deployInstance(policyId: string, wallet: string): Promise<{ contractId: string }>;
  recordDeployment(policyId: string, txHash: string, contractId?: string): Promise<GeneratedPolicy>;

  // Compensations. A deployment service that cannot revoke an instance should
  // still expose these as no-ops so the saga's undo surface stays explicit.
  deletePolicy(policyId: string): Promise<void>;
  revokeInstance(policyId: string, contractId: string): Promise<void>;
}

export interface DeploymentState {
  definition: PolicyDefinition;
  wallet: string;
  txHash: string;
  policyId?: string;
  contractId?: string;
  policy?: GeneratedPolicy;
}

export function policyDeploymentSteps(api: PolicyDeployApi): DeploymentStep<DeploymentState>[] {
  return [
    {
      name: "generate",
      async run(state) {
        const policy = await api.generate(state.definition);
        return { ...state, policyId: policy.id, policy };
      },
      // An orphaned generated policy is invisible to the user but still occupies
      // its name/id in the service, so it has to go.
      async compensate(state) {
        if (state.policyId) await api.deletePolicy(state.policyId);
      },
    },
    {
      name: "simulate",
      async run(state) {
        const result = await api.simulate(state.policyId!, state.wallet);
        if (!result.ok) {
          throw new Error(`policy simulation rejected the deploy: ${result.reason ?? "unknown"}`);
        }
        return state;
      },
      // Read-only dry run: nothing to undo.
    },
    {
      name: "deployInstance",
      async run(state) {
        const { contractId } = await api.deployInstance(state.policyId!, state.wallet);
        return { ...state, contractId };
      },
      // The instance exists on chain at this point. Revoking is what keeps a
      // failed recordDeployment from leaving an unreferenced live policy
      // attached to the wallet.
      async compensate(state) {
        if (state.policyId && state.contractId) {
          await api.revokeInstance(state.policyId, state.contractId);
        }
      },
    },
    {
      name: "recordDeployment",
      async run(state) {
        const policy = await api.recordDeployment(state.policyId!, state.txHash, state.contractId);
        return { ...state, policy };
      },
    },
  ];
}

export async function deployPolicyWithRollback(
  api: PolicyDeployApi,
  input: { definition: PolicyDefinition; wallet: string; txHash: string },
  options: RunDeploymentOptions = {},
): Promise<GeneratedPolicy> {
  const finalState = await runDeploymentWithRollback(
    policyDeploymentSteps(api),
    { ...input },
    options,
  );
  return finalState.policy!;
}
