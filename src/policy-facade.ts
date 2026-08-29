import type { Network, PolicyDefinition } from "./types";
import { createPolicyClient, type PolicyClient } from "./policy-client";
import type {
  DeployPolicyResult,
  GeneratedPolicy,
  PolicyTemplateInfo,
  SimulateResult,
} from "./policy-types";

// The policy surface on the wallet handle (vellar.policies). Read/prepare go
// through the HTTP client; deploy() is the headline — it runs the full
// passkey-signed attach the dapp does:
//   1. deploy the per-user policy contract instance (server-side, sponsor-funded)
//   2. passkey-sign kit.addPolicy to attach it  ← the ONLY passkey prompt
//   3. record the completed attach
// No silent signing; the backend is required for simulate/deploy (sponsor keys
// live server-side), so those fail loudly when unconfigured.

/** The passkey-attach capability the deploy step needs. The host wires this to
 * `kit.addPolicy(contractId) → kit.sign(tx) → backend.submitTransaction(...)`;
 * kept as a narrow seam so the core kit type doesn't have to grow addPolicy and
 * so it's trivially mockable in tests. */
export interface PolicyAttachRuntime {
  /** Resume the connected passkey for a keyId without prompting, when possible. */
  resume?(keyId: string): Promise<void>;
  /** Build kit.addPolicy(contractId), passkey-sign it, submit it. Returns the
   * on-chain tx hash. This is where the WebAuthn prompt happens. */
  attachPolicy(policyContractId: string): Promise<{ hash: string }>;
}

export type PolicyDeployStepName =
  | "deploy_instance"
  | "attach_policy"
  | "record_deployment";

export type PolicyDeployStepOutcome = "started" | "success" | "failed";

export interface PolicyDeployStepPayload {
  /** The name of the deployment step. */
  step: PolicyDeployStepName;
  /** The outcome of the step. */
  outcome: PolicyDeployStepOutcome;
  /** ID of the policy being deployed. */
  policyId: string;
  /** Address of the deployed policy contract instance (when available). */
  contractId?: string;
  /** On-chain transaction hash from passkey attach (when available). */
  txHash?: string;
  /** Error encountered if outcome is 'failed'. */
  error?: unknown;
}

export type PolicyStepHook = (payload: PolicyDeployStepPayload) => void | Promise<void>;

export interface DeployPolicyOptions {
  /** Optional per-call step hook. */
  onStep?: PolicyStepHook;
}

export interface PolicyFacade {
  listTemplates(): Promise<PolicyTemplateInfo[]>;
  /** Validate + generate the deployable artifacts for a definition. */
  generate(definition: PolicyDefinition): Promise<GeneratedPolicy>;
  /** Dry-run the on-chain deploy for the connected wallet (no submit). */
  simulate(policyId: string): Promise<SimulateResult>;
  /** Attach a generated policy to the connected wallet (passkey-signed). */
  deploy(policyId: string, options?: DeployPolicyOptions): Promise<DeployPolicyResult>;
  /** The lower-level HTTP client, for custom flows. */
  readonly client: PolicyClient;
}

export interface PolicyFacadeDeps {
  apiUrl: string;
  network: Network;
  /** Returns the connected wallet's account id + keyId, or throws if not ready. */
  requireSession(): { accountId: string; keyId?: string };
  /** The passkey-attach runtime (undefined ⇒ deploy() throws a clear error). */
  attach?: PolicyAttachRuntime;
  fetch?: typeof fetch;
  /** Optional structured logging hook invoked at each step of policy deployment. */
  onStep?: PolicyStepHook;
}

export class PolicyNotDeployableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyNotDeployableError";
  }
}

export function createPolicyFacade(deps: PolicyFacadeDeps): PolicyFacade {
  const client = createPolicyClient({
    apiUrl: deps.apiUrl,
    network: deps.network,
    fetch: deps.fetch,
  });

  return {
    client,
    listTemplates() {
      return client.listTemplates();
    },
    generate(definition) {
      return client.generate(definition);
    },
    simulate(policyId) {
      const { accountId } = deps.requireSession();
      return client.simulate(policyId, accountId);
    },
    async deploy(policyId, options) {
      const onStep = options?.onStep ?? deps.onStep;
      const reportStep = async (
        step: PolicyDeployStepName,
        outcome: PolicyDeployStepOutcome,
        extra?: Partial<PolicyDeployStepPayload>,
      ) => {
        if (!onStep) return;
        try {
          await onStep({ step, outcome, policyId, ...extra });
        } catch {
          // Structured logging hook failures should not abort deployment unless intended
        }
      };

      const session = deps.requireSession();
      if (!deps.attach) {
        throw new PolicyNotDeployableError(
          "Policy deploy needs a passkey-attach runtime. This wallet was created without one — provide `policyAttach` in the config (or use the web app runtime).",
        );
      }

      // 1. server-side, sponsor-funded instance deploy bound to the wallet.
      let contractId: string;
      await reportStep("deploy_instance", "started");
      try {
        const deployed = await client.deployInstance(policyId, session.accountId);
        contractId = deployed.contractId;
        await reportStep("deploy_instance", "success", { contractId });
      } catch (err) {
        await reportStep("deploy_instance", "failed", { error: err });
        throw err;
      }

      // 2. passkey-sign the attach (the ONLY prompt).
      let hash: string;
      await reportStep("attach_policy", "started", { contractId });
      try {
        if (session.keyId && deps.attach.resume) await deps.attach.resume(session.keyId);
        const attached = await deps.attach.attachPolicy(contractId);
        hash = attached.hash;
        await reportStep("attach_policy", "success", { contractId, txHash: hash });
      } catch (err) {
        await reportStep("attach_policy", "failed", { contractId, error: err });
        throw err;
      }

      // 3. record the completed attach.
      let policy: unknown;
      await reportStep("record_deployment", "started", { contractId, txHash: hash });
      try {
        policy = await client.recordDeployment(policyId, hash, contractId);
        await reportStep("record_deployment", "success", { contractId, txHash: hash });
      } catch (err) {
        await reportStep("record_deployment", "failed", { contractId, txHash: hash, error: err });
        throw err;
      }

      return { policy: policy as DeployPolicyResult["policy"], contractId, attachTxHash: hash };
    },
  };
}
