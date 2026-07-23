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

export interface PolicyFacade {
  listTemplates(): Promise<PolicyTemplateInfo[]>;
  /** Validate + generate the deployable artifacts for a definition. */
  generate(definition: PolicyDefinition): Promise<GeneratedPolicy>;
  /** Dry-run the on-chain deploy for the connected wallet (no submit). */
  simulate(policyId: string): Promise<SimulateResult>;
  /** Attach a generated policy to the connected wallet (passkey-signed). */
  deploy(policyId: string): Promise<DeployPolicyResult>;
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
    async deploy(policyId) {
      const session = deps.requireSession();
      if (!deps.attach) {
        throw new PolicyNotDeployableError(
          "Policy deploy needs a passkey-attach runtime. This wallet was created without one — provide `policyAttach` in the config (or use the web app runtime).",
        );
      }
      // 1. server-side, sponsor-funded instance deploy bound to the wallet.
      const { contractId } = await client.deployInstance(policyId, session.accountId);
      // 2. passkey-sign the attach (the ONLY prompt).
      if (session.keyId && deps.attach.resume) await deps.attach.resume(session.keyId);
      const { hash } = await deps.attach.attachPolicy(contractId);
      // 3. record the completed attach.
      const policy = await client.recordDeployment(policyId, hash, contractId);
      return { policy, contractId, attachTxHash: hash };
    },
  };
}
