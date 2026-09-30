import type { Network, PolicyDefinition } from "./types";
import { createPolicyClient, type PolicyClient } from "./policy-client";
import type {
  DeployPolicyResult,
  GeneratedPolicy,
  PolicyTemplateInfo,
  SimulateResult,
} from "./policy-types";
import { PolicyApiError } from "./policy-types";

// The policy surface on the wallet handle (vellar.policies). Read/prepare go
// through the HTTP client; deploy() is the headline — it runs the full
// passkey-signed attach the dapp does:
//   1. deploy the per-user policy contract instance (server-side, sponsor-funded)
//   2. passkey-sign kit.addPolicy to attach it  ← the ONLY passkey prompt
//   3. record the completed attach
// No silent signing; the backend is required for simulate/deploy (sponsor keys
// live server-side), so those fail loudly when unconfigured.
//
// RESUME: if the process dies between step 2 landing on-chain and step 3
// succeeding, the policy is attached but not recorded. Re-running deploy() from
// the start would deploy a second instance and prompt for a second passkey
// signature. Instead:
//   - deploy() surfaces DeployPolicyError with enough state (contractId,
//     attachHash) for a caller to call resumeDeploy() and complete only step 3.
//   - resumeDeploy() takes a known attach tx hash and performs only the record.
//   - The passkey prompt must never be issued twice for one logical deploy.

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
  /** Resume a deploy from a known attach tx hash — performs only the record
   * step, without issuing a passkey prompt. Use this when deploy() threw a
   * DeployPolicyError with an attachHash. */
  resumeDeploy(policyId: string, attachTxHash: string, contractId?: string): Promise<DeployPolicyResult>;
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

/** Thrown when deploy() fails after the instance has been deployed (and possibly
 * after the attach has landed on-chain). Carries enough state for a caller to
 * resume via resumeDeploy() without re-prompting the passkey. */
export class DeployPolicyError extends Error {
  /** The policy contract instance id (always present — the instance deploy succeeded). */
  readonly contractId: string;
  /** The attach tx hash, if the attach step completed before the failure. */
  readonly attachHash?: string;
  /** The underlying cause. */
  readonly cause?: Error;

  constructor(message: string, contractId: string, attachHash?: string, cause?: Error) {
    super(message);
    this.name = "DeployPolicyError";
    this.contractId = contractId;
    this.attachHash = attachHash;
    this.cause = cause;
  }
}

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 500;

async function retryIfRetryable<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (err instanceof PolicyApiError && err.retryable && attempt < MAX_RETRY_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
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

      let contractId: string;
      try {
        // 1. server-side, sponsor-funded instance deploy bound to the wallet.
        // Retry on retryable (503 / transport) errors — nothing was decided yet.
        const result = await retryIfRetryable(() =>
          client.deployInstance(policyId, session.accountId),
        );
        contractId = result.contractId;
      } catch (err) {
        throw err;
      }

      let attachHash: string | undefined;
      try {
        // 2. passkey-sign the attach (the ONLY prompt).
        // Do NOT retry this step — retrying would re-prompt the user's passkey,
        // which is the exact cost this module exists to avoid.
        if (session.keyId && deps.attach.resume) await deps.attach.resume(session.keyId);
        const result = await deps.attach.attachPolicy(contractId);
        attachHash = result.hash;
      } catch (err) {
        throw new DeployPolicyError(
          "Policy attach failed. Use resumeDeploy() with the contractId to retry the record step once the attach lands on-chain.",
          contractId,
          undefined,
          err instanceof Error ? err : undefined,
        );
      }

      try {
        // 3. record the completed attach. Retry on retryable errors.
        const policy = await retryIfRetryable(() =>
          client.recordDeployment(policyId, attachHash!, contractId),
        );
        return { policy, contractId, attachTxHash: attachHash! };
      } catch (err) {
        throw new DeployPolicyError(
          "Policy attach succeeded but recording failed. Use resumeDeploy() with the attachHash to complete the record step.",
          contractId,
          attachHash,
          err instanceof Error ? err : undefined,
        );
      }
    },

    async resumeDeploy(policyId: string, attachTxHash: string, contractId?: string) {
      deps.requireSession();
      // Resume performs only the record step — no passkey prompt, no instance deploy.
      const policy = await retryIfRetryable(() =>
        client.recordDeployment(policyId, attachTxHash, contractId),
      );
      return { policy, contractId: contractId ?? "", attachTxHash };
    },
  };
}