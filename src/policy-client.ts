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

/**
 * Fired when the local `listTemplates()` cache is invalidated (#232). Purely
 * observational — invalidation happens regardless of whether a listener is
 * attached. Injectable rather than a hardcoded `console.debug` call, matching
 * this SDK's existing seams (`fetch`, `webAuthn`) so a host can route it into
 * its own logger, or ignore it entirely.
 */
export interface CacheInvalidationEvent {
  /** What was invalidated. Only "templates" exists today; the union leaves
   * room for future cached endpoints without a breaking change to the type. */
  cache: "templates";
  /** Why: an explicit `refreshTemplates()` call, or a mutation this client
   * made that could have changed template data server-side. */
  reason: "explicit-refresh" | "template-update";
  /** When the invalidation happened. */
  at: string;
}

export interface PolicyClientOptions {
  /** Gateway base URL (e.g. https://api.myapp.com). */
  apiUrl: string;
  /** Network passed to generate() (which network the policy targets). */
  network: Network;
  /** Injected fetch; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Called whenever the templates cache is invalidated. See {@link CacheInvalidationEvent}. */
  onCacheInvalidated?: (event: CacheInvalidationEvent) => void;
  /** Injected clock (tests only); defaults to `() => new Date()`. */
  now?: () => Date;
}

export interface PolicyClient {
  /**
   * GET /policies/templates — the available policy templates + enforcement.
   * Cached in memory after the first call; subsequent calls return the
   * cached list without a network round-trip until the cache is invalidated
   * (see `refreshTemplates` and {@link CacheInvalidationEvent}).
   */
  listTemplates(): Promise<PolicyTemplateInfo[]>;
  /** GET /policies — list generated policies, optionally filtered. */
  listPolicies(filters?: PolicyListFilters): Promise<GeneratedPolicy[]>;
  /**
   * Invalidate the local templates cache and re-fetch immediately, returning
   * the fresh list. Call this after any out-of-band change to templates
   * (e.g. an admin action elsewhere) that this client couldn't have observed
   * on its own.
   */
  refreshTemplates(): Promise<PolicyTemplateInfo[]>;
  /** POST /policies/validate — validate a definition without generating. */
  validate(definition: PolicyDefinition): Promise<ValidationResult>;
  /**
   * POST /policies/generate — validate + produce the deployable artifacts.
   * Invalidates the local templates cache: a template's generated-artifact
   * shape can evolve server-side between calls, so treat any successful
   * generate as a signal the cached listing may be stale.
   */
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
  const now = options.now ?? (() => new Date());

  let templatesCache: PolicyTemplateInfo[] | undefined;
  let templatesInFlight: Promise<PolicyTemplateInfo[]> | undefined;

  function invalidateTemplatesCache(reason: CacheInvalidationEvent["reason"]): void {
    if (templatesCache === undefined) return; // nothing cached — nothing to invalidate
    templatesCache = undefined;
    options.onCacheInvalidated?.({ cache: "templates", reason, at: now().toISOString() });
  }

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

  function listTemplates(): Promise<PolicyTemplateInfo[]> {
    // In-flight de-duplication: a burst of concurrent callers (e.g. several
    // components mounting at once) share one request instead of each firing
    // their own, and all observe the same cached result once it resolves.
    if (templatesCache !== undefined) return Promise.resolve(templatesCache);
    if (templatesInFlight) return templatesInFlight;

    templatesInFlight = req<PolicyTemplateInfo[]>("/templates")
      .then((templates) => {
        templatesCache = templates;
        return templates;
      })
      .finally(() => {
        templatesInFlight = undefined;
      });
    return templatesInFlight;
  }

  return {
    listTemplates,
    refreshTemplates() {
      invalidateTemplatesCache("explicit-refresh");
      return listTemplates();
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
      invalidateTemplatesCache("template-update");
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
