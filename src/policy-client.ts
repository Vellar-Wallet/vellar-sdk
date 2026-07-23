import type { Network, PolicyDefinition } from "./types";
import {
  PolicyApiError,
  type GeneratedPolicy,
  type PolicyTemplateInfo,
  type SimulateResult,
  type ValidationResult,
} from "./policy-types";

// Policy API client (idea.md §11): thin, injectable-fetch wrappers over the
// policy-service endpoints, behind the gateway. Read/prepare only — the
// passkey-signed attach lives on the wallet facade (createVellarWallet), because
// it needs the wallet's kit + backend. Mirrors createHttpWalletBackend /
// createVerificationClient so all SDK clients look the same.

export interface PolicyClientOptions {
  /** Gateway base URL (e.g. https://api.myapp.com). */
  apiUrl: string;
  /** Network passed to generate() (which network the policy targets). */
  network: Network;
  /** Injected fetch; defaults to global fetch. */
  fetch?: typeof fetch;
}

export interface PolicyClient {
  /** GET /policies/templates — the available policy templates + enforcement. */
  listTemplates(): Promise<PolicyTemplateInfo[]>;
  /** POST /policies/validate — validate a definition without generating. */
  validate(definition: PolicyDefinition): Promise<ValidationResult>;
  /** POST /policies/generate — validate + produce the deployable artifacts. */
  generate(definition: PolicyDefinition): Promise<GeneratedPolicy>;
  /** POST /policies/:id/simulate — dry-run the instance deploy for a wallet. */
  simulate(policyId: string, wallet: string): Promise<SimulateResult>;
  /** POST /policies/:id/deploy-instance — sponsor-funded instance deploy. */
  deployInstance(policyId: string, wallet: string): Promise<{ contractId: string }>;
  /** POST /policies/deploy — record a completed attach (after passkey signing). */
  recordDeployment(policyId: string, txHash: string, contractId?: string): Promise<GeneratedPolicy>;
}

export function createPolicyClient(options: PolicyClientOptions): PolicyClient {
  const base = options.apiUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;

  async function req<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${base}/policies${path}`, {
        headers: init?.body ? { "content-type": "application/json" } : undefined,
        ...init,
      });
    } catch (err) {
      throw new PolicyApiError(err instanceof Error ? err.message : "network request failed", 0);
    }
    const payload = (await res.json().catch(() => ({}))) as {
      error?: string;
      errors?: string[];
      message?: string;
    } & T;
    if (!res.ok) {
      throw new PolicyApiError(
        payload.message ?? payload.error ?? `Request failed (${res.status})`,
        res.status,
        payload.errors,
      );
    }
    return payload;
  }

  return {
    listTemplates() {
      return req<PolicyTemplateInfo[]>("/templates");
    },
    validate(definition) {
      return req<ValidationResult>("/validate", {
        method: "POST",
        body: JSON.stringify(definition),
      });
    },
    async generate(definition) {
      const { policy } = await req<{ policy: GeneratedPolicy }>("/generate", {
        method: "POST",
        body: JSON.stringify({ definition, network: options.network }),
      });
      return policy;
    },
    simulate(policyId, wallet) {
      return req<SimulateResult>(`/${policyId}/simulate`, {
        method: "POST",
        body: JSON.stringify({ wallet }),
      });
    },
    async deployInstance(policyId, wallet) {
      const { contractId } = await req<{ contractId: string }>(`/${policyId}/deploy-instance`, {
        method: "POST",
        body: JSON.stringify({ wallet }),
      });
      return { contractId };
    },
    async recordDeployment(policyId, txHash, contractId) {
      const { policy } = await req<{ policy: GeneratedPolicy }>("/deploy", {
        method: "POST",
        body: JSON.stringify({ policyId, txHash, contractId }),
      });
      return policy;
    },
  };
}
