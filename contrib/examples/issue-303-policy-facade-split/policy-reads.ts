/**
 * The read half of the policy facade — operations with no side effects.
 *
 * Contributed for issue #303: `src/policy-facade.ts` mixes read operations and
 * write operations in one file, making it harder to reason about side effects.
 * This is the read module; `policy-writes.ts` is the write module, and
 * `policy-facade-split.ts` composes them back into the same `PolicyFacade` the
 * wallet handle exposes today.
 *
 * The split is drawn on a single question: **can calling this twice change
 * anything?** Everything in this file answers no. Nothing here deploys a
 * contract, prompts for a passkey, spends a sponsor's funds, or writes a row.
 * Every function is safe to call speculatively, safe to retry after a timeout,
 * and safe to run concurrently.
 *
 * That property is the point of the split, and it is what the module boundary
 * is there to protect: a future operation that mutates anything does not belong
 * in this file, however read-like its name sounds.
 *
 * Note on `validate()`: it is a POST, because a policy definition is too large
 * for a query string — but it decides nothing and stores nothing, so it is a
 * read. HTTP method is not what makes an operation a write; persisting a
 * decision is. (`generate()` is the mirror image and lives in the write module:
 * it looks like a pure transform, but the policy it returns is persisted with a
 * status. See that file.)
 */

import type {
  PolicyClientLike,
  PolicyDefinitionLike,
  GeneratedPolicyLike,
  PolicyTemplateInfoLike,
  SimulateResultLike,
  ValidationResultLike,
  RequireSession,
} from "./policy-facade-types";

/** The read-only surface of the policy facade. */
export interface PolicyReadOperations {
  /** The available policy templates and their enforcement semantics. */
  listTemplates(): Promise<PolicyTemplateInfoLike[]>;
  /** Validate a definition without generating or storing anything. */
  validate(definition: PolicyDefinitionLike): Promise<ValidationResultLike>;
  /**
   * Dry-run the on-chain deploy for the connected wallet.
   *
   * Nothing is submitted — this is the simulation the gateway runs to report
   * cost and outcome. Requires a connected session, since the simulation is
   * bound to a specific wallet.
   */
  simulate(policyId: string): Promise<SimulateResultLike>;
  /** List generated policies, optionally filtered. */
  listPolicies(filters?: unknown): Promise<GeneratedPolicyLike[]>;
}

export interface PolicyReadDeps {
  client: PolicyClientLike;
  /** Returns the connected wallet's account id + keyId, or throws if not ready. */
  requireSession: RequireSession;
}

/**
 * Build the read half of the facade.
 *
 * Every method here delegates straight to the HTTP client. The only local logic
 * is resolving the connected account for `simulate`, which is why `simulate` is
 * the one read that can fail without touching the network: no session, no
 * wallet to simulate against.
 */
export function createPolicyReads(deps: PolicyReadDeps): PolicyReadOperations {
  const { client, requireSession } = deps;

  return {
    listTemplates() {
      return client.listTemplates();
    },

    validate(definition) {
      // A POST, but nothing is persisted — see the module comment.
      return client.validate(definition);
    },

    // `async` so a throwing `requireSession` surfaces as a rejected promise
    // rather than a synchronous throw at the call site. Callers `await` this;
    // a sync throw would escape their try/catch around the await.
    async simulate(policyId) {
      // Resolved before the call so an unconnected wallet fails fast and
      // locally, rather than as a confusing gateway error.
      const { accountId } = requireSession();
      return client.simulate(policyId, accountId);
    },

    listPolicies(filters) {
      return client.listPolicies(filters);
    },
  };
}
