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

const DEFAULT_POLICY_TIMEOUT_MS = 10_000;

export class PolicyRequestTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Policy RPC request timed out after ${timeoutMs}ms`);
    this.name = "PolicyRequestTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export interface PolicyClientOptions {
  /** Gateway base URL (e.g. https://api.myapp.com). */
  apiUrl: string;
  /** Network passed to generate() (which network the policy targets). */
  network: Network;
  /** Injected fetch; defaults to global fetch. */
  fetch?: typeof fetch;
  /**
   * Maximum time allowed for each policy RPC request.
   * Defaults to 10 seconds.
   */
  timeoutMs?: number;
}

export interface PolicyClient {
  /** GET /policies/templates — the available policy templates + enforcement. */
  listTemplates(): Promise<PolicyTemplateInfo[]>;
  /** GET /policies — list generated policies, optionally filtered. */
  listPolicies(filters?: PolicyListFilters): Promise<GeneratedPolicy[]>;
  /** POST /policies/validate — validate a definition without generating. */
  validate(definition: PolicyDefinition): Promise<ValidationResult>;
  /** POST /policies/generate — validate + produce the deployable artifacts. */
  generate(definition: PolicyDefinition): Promise<GeneratedPolicy>;
  /** POST /policies/:id/simulate — dry-run the instance deploy for a wallet. */
  simulate(policyId: string, wallet: string): Promise<SimulateResult>;
  /** POST /policies/:id/deploy-instance — sponsor-funded instance deploy. */
  deployInstance(policyId: string, wallet: string): Promise<{ contractId: string }>;
  /** POST /policies/deploy — record a completed attach (after passkey signing). */
  recordDeployment(
    policyId: string,
    txHash: string,
    contractId?: string,
  ): Promise<GeneratedPolicy>;
}

export function createPolicyClient(options: PolicyClientOptions): PolicyClient {
  const base = options.apiUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_POLICY_TIMEOUT_MS;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("timeoutMs must be greater than 0");
  }

  async function req<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      let res: Response;

      try {
        res = await doFetch(`${base}/policies${path}`, {
          headers: init?.body
            ? { "content-type": "application/json" }
            : undefined,
          ...init,
          signal: controller.signal,
        });
      } catch (err) {
        if (
          err instanceof DOMException &&
          err.name === "AbortError"
        ) {
          throw new PolicyRequestTimeoutError(timeoutMs);
        }

        if (err instanceof Error && err.name === "AbortError") {
          throw new PolicyRequestTimeoutError(timeoutMs);
        }

        throw new PolicyApiError(
          err instanceof Error ? err.message : "network request failed",
          0,
        );
      }

      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        errors?: string[];
        message?: string;
      } & T;

      if (!res.ok) {
        throw new PolicyApiError(
          payload.message ??
            payload.error ??
            `Request failed (${res.status})`,
          res.status,
          payload.errors,
        );
      }

      return payload;
    } finally {
      clearTimeout(timeout);
    }
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
        body: JSON.stringify({
          definition,
          network: options.network,
        }),
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
      const { contractId } = await req<{ contractId: string }>(
        `/${policyId}/deploy-instance`,
        {
          method: "POST",
          body: JSON.stringify({ wallet }),
        },
      );

      return { contractId };
    },

    async recordDeployment(policyId, txHash, contractId) {
      const { policy } = await req<{ policy: GeneratedPolicy }>("/deploy", {
        method: "POST",
        body: JSON.stringify({
          policyId,
          txHash,
          contractId,
        }),
      });

      return policy;
    },
  };
}
