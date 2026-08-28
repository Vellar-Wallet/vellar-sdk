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

export type PolicyListStatus = "active" | "draft" | "revoked";

export interface PolicyListFilters {
  status?: PolicyListStatus;
  createdAfter?: string;
  createdBefore?: string;
}

/** Thrown when list filter params are malformed (e.g. invalid dates). */
export class PolicyListFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyListFilterError";
  }
}

function parseFilterDate(name: string, value: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new PolicyListFilterError(`invalid ${name}: ${value}`);
  }
}

function buildListQuery(filters?: PolicyListFilters): string {
  if (!filters) return "";
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.createdAfter) {
    parseFilterDate("created_after", filters.createdAfter);
    params.set("created_after", filters.createdAfter);
  }
  if (filters.createdBefore) {
    parseFilterDate("created_before", filters.createdBefore);
    params.set("created_before", filters.createdBefore);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export interface PolicyClientOptions {
  /** Gateway base URL (e.g. https://api.myapp.com). */
  apiUrl: string;
  /** Network passed to generate() (which network the policy targets). */
  network: Network;
  /** Injected fetch; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Receives rollback lifecycle events; defaults to console.warn. */
  onRollback?: RollbackLogger;
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
  recordDeployment(policyId: string, txHash: string, contractId?: string): Promise<GeneratedPolicy>;
  /**
   * Generate → simulate → deploy-instance as one unit, rolling back on a
   * partial failure (issue #219).
   *
   * NOTE: no multi-step deployment routine existed in this client before this
   * change; each endpoint was called independently by consumers. The step
   * order and the compensating actions below are a proposed design and need
   * maintainer confirmation.
   */
  deployPolicy(definition: PolicyDefinition, wallet: string): Promise<OrchestratedDeployResult>;
}

/** A completed step, retained so it can be compensated in reverse. */
export interface DeploymentStep {
  name: DeploymentStepName;
  policyId?: string;
  contractId?: string;
}

export type DeploymentStepName = "generate" | "simulate" | "deploy-instance";

/**
 * Result of the orchestrated deploy. Distinct from `policy-types`'
 * `DeployPolicyResult`, which additionally carries the passkey-signed
 * `attachTxHash` produced by the wallet facade — this client never signs.
 */
export interface OrchestratedDeployResult {
  policy: GeneratedPolicy;
  contractId: string;
}

/** Emitted for every rollback attempt (issue #219 logging requirement). */
export interface RollbackEvent {
  step: DeploymentStepName;
  policyId?: string;
  contractId?: string;
  status: "started" | "succeeded" | "failed";
  error?: string;
}

export type RollbackLogger = (event: RollbackEvent) => void;

/**
 * Raised when deployment failed AND at least one compensating action also
 * failed, leaving state a caller must reconcile by hand. `cause` is always the
 * original deployment error — a failed rollback never masks it.
 */
export class PolicyDeploymentRollbackError extends Error {
  constructor(
    message: string,
    readonly completed: DeploymentStep[],
    readonly rollbackFailures: RollbackEvent[],
    override readonly cause: unknown,
  ) {
    super(message);
    this.name = "PolicyDeploymentRollbackError";
  }
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
    listPolicies(filters) {
      return req<GeneratedPolicy[]>(buildListQuery(filters));
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

    async deployPolicy(definition, wallet) {
      const completed: DeploymentStep[] = [];
      const log: RollbackLogger =
        options.onRollback ??
        ((e) => {
          if (e.status === "failed") {
            console.warn(`[policy-rollback] ${e.step} ${e.status}: ${e.error ?? ""}`);
          }
        });

      try {
        const { policy } = await req<{ policy: GeneratedPolicy }>("/generate", {
          method: "POST",
          body: JSON.stringify({ definition, network: options.network }),
        });
        completed.push({ name: "generate", policyId: policy.id });

        await req<SimulateResult>(`/${policy.id}/simulate`, {
          method: "POST",
          body: JSON.stringify({ wallet }),
        });
        completed.push({ name: "simulate", policyId: policy.id });

        const { contractId } = await req<{ contractId: string }>(
          `/${policy.id}/deploy-instance`,
          { method: "POST", body: JSON.stringify({ wallet }) },
        );
        completed.push({ name: "deploy-instance", policyId: policy.id, contractId });

        return { policy, contractId };
      } catch (err) {
        const failures = await rollback(completed, log);
        if (failures.length > 0) {
          throw new PolicyDeploymentRollbackError(
            `policy deployment failed and ${failures.length} compensating action(s) also failed; ` +
              `manual reconciliation required`,
            completed,
            failures,
            err,
          );
        }
        throw err;
      }
    },
  };

  /**
   * Compensates completed steps in reverse order. Every compensation is
   * attempted even if an earlier one fails, so one stuck resource can't strand
   * the rest. Returns the failures rather than throwing — the caller decides
   * how to surface them alongside the original error.
   */
  async function rollback(
    completed: DeploymentStep[],
    log: RollbackLogger,
  ): Promise<RollbackEvent[]> {
    const failures: RollbackEvent[] = [];
    for (const step of [...completed].reverse()) {
      // `simulate` is a dry run — it mutates nothing, so it has no compensation.
      if (step.name === "simulate") continue;
      const base = { step: step.name, policyId: step.policyId, contractId: step.contractId };
      log({ ...base, status: "started" });
      try {
        if (step.name === "deploy-instance" && step.policyId && step.contractId) {
          await req(`/${step.policyId}/instances/${step.contractId}`, { method: "DELETE" });
        } else if (step.name === "generate" && step.policyId) {
          await req(`/${step.policyId}`, { method: "DELETE" });
        }
        log({ ...base, status: "succeeded" });
      } catch (err) {
        const event: RollbackEvent = {
          ...base,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        };
        log(event);
        failures.push(event);
      }
    }
    return failures;
  }
}
