/**
 * Structured logging wrapper for policy facade deployment steps (Issue #253).
 * Tracks phase transitions: deploy_instance, attach_policy, record_deployment.
 */

export type PolicyDeployStepName =
  | "deploy_instance"
  | "attach_policy"
  | "record_deployment";

export type PolicyDeployStepOutcome = "started" | "success" | "failed";

export interface PolicyDeployStepPayload {
  step: PolicyDeployStepName;
  outcome: PolicyDeployStepOutcome;
  policyId: string;
  contractId?: string;
  error?: unknown;
  metadata?: Record<string, unknown>;
}

export type PolicyStepHook = (payload: PolicyDeployStepPayload) => void | Promise<void>;

export interface PolicyDeployExecutionOptions {
  policyId: string;
  onStep?: PolicyStepHook;
}

export interface PolicyDeployTasks {
  deployInstance: (policyId: string) => Promise<{ contractId: string }>;
  attachPolicy: (contractId: string) => Promise<void>;
  recordDeployment: (policyId: string, contractId: string) => Promise<void>;
}

export async function executePolicyDeployment(
  tasks: PolicyDeployTasks,
  options: PolicyDeployExecutionOptions,
): Promise<{ contractId: string }> {
  const { policyId, onStep } = options;

  async function report(
    step: PolicyDeployStepName,
    outcome: PolicyDeployStepOutcome,
    contractId?: string,
    error?: unknown,
  ) {
    if (!onStep) return;
    try {
      await onStep({ step, outcome, policyId, contractId, error });
    } catch {
      // Step hook failures must not crash deployment
    }
  }

  // 1. Deploy Instance
  await report("deploy_instance", "started");
  let contractId: string;
  try {
    const res = await tasks.deployInstance(policyId);
    contractId = res.contractId;
    await report("deploy_instance", "success", contractId);
  } catch (err) {
    await report("deploy_instance", "failed", undefined, err);
    throw err;
  }

  // 2. Attach Policy
  await report("attach_policy", "started", contractId);
  try {
    await tasks.attachPolicy(contractId);
    await report("attach_policy", "success", contractId);
  } catch (err) {
    await report("attach_policy", "failed", contractId, err);
    throw err;
  }

  // 3. Record Deployment
  await report("record_deployment", "started", contractId);
  try {
    await tasks.recordDeployment(policyId, contractId);
    await report("record_deployment", "success", contractId);
  } catch (err) {
    await report("record_deployment", "failed", contractId, err);
    throw err;
  }

  return { contractId };
}
