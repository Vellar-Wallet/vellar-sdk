/**
 * Cache invalidation for policy template listings.
 *
 * Contributed for issue #232: `PolicyClient.listTemplates()` in
 * src/policy-client.ts has no caching at all today — every call is a fresh
 * network round-trip, and there is no local cache for a mutation to
 * invalidate.
 *
 * This wraps any `PolicyClient` (the structural interface `createPolicyClient`
 * returns — see `src/policy-client.ts`) with an in-memory `listTemplates()`
 * cache, invalidated automatically by `generate()` (a mutation that could
 * change template state server-side) and by an explicit `refreshTemplates()`.
 *
 * Two properties carry the guarantee, same shape as `issue-209`'s idempotency
 * wrapper:
 *
 *  1. The IN-FLIGHT promise is cached, not only the settled result — a burst
 *     of concurrent `listTemplates()` callers (e.g. several components
 *     mounting at once) share one request instead of each firing their own.
 *
 *  2. Invalidation fires an `onCacheInvalidated` event rather than a
 *     hardcoded `console.debug` call, so a host can route it into its own
 *     logger or ignore it — matching the SDK's existing injectable-callback
 *     conventions (`fetch`, `webAuthn`).
 *
 * Run with: npx vitest run contrib/examples/issue-232-policy-template-cache
 */

import type { GeneratedPolicy, PolicyTemplateInfo } from "../../../src/policy-types";
import type { PolicyDefinition } from "../../../src/types";

/** Structural match for `PolicyClient` in src/policy-client.ts — only the
 * two methods this wrapper actually touches are required, so it composes
 * with the real client (which has more methods) or a test double. */
export interface PolicyClientLike {
  listTemplates(): Promise<PolicyTemplateInfo[]>;
  generate(definition: PolicyDefinition): Promise<GeneratedPolicy>;
}

/**
 * Fired when the local `listTemplates()` cache is invalidated. Purely
 * observational — invalidation happens regardless of whether a listener is
 * attached.
 */
export interface CacheInvalidationEvent {
  cache: "templates";
  /** Why: an explicit `refreshTemplates()` call, or a `generate()` call that
   * could have changed template data server-side. */
  reason: "explicit-refresh" | "template-update";
  at: string;
}

export interface CachedPolicyClientOptions {
  /** Called whenever the templates cache is invalidated. */
  onCacheInvalidated?: (event: CacheInvalidationEvent) => void;
  /** Injected clock (tests only); defaults to `() => new Date()`. */
  now?: () => Date;
}

export interface CachedPolicyClient<T extends PolicyClientLike> {
  listTemplates(): Promise<PolicyTemplateInfo[]>;
  /** Invalidate the cache and re-fetch immediately, returning the fresh list.
   * Call this after any out-of-band change to templates (e.g. an admin
   * action elsewhere) that this wrapper couldn't have observed on its own. */
  refreshTemplates(): Promise<PolicyTemplateInfo[]>;
  generate(definition: PolicyDefinition): Promise<GeneratedPolicy>;
  /** The wrapped client, for methods this wrapper doesn't touch. */
  readonly inner: T;
}

/**
 * Wrap a `PolicyClient`-like object with a `listTemplates()` cache. `generate`
 * is passed through but ALSO invalidates the cache first (well, after it
 * resolves — see below), since a successful generate is a signal the cached
 * listing may be stale.
 */
export function withTemplateCache<T extends PolicyClientLike>(
  client: T,
  options: CachedPolicyClientOptions = {},
): CachedPolicyClient<T> {
  const now = options.now ?? (() => new Date());

  let cache: PolicyTemplateInfo[] | undefined;
  let inFlight: Promise<PolicyTemplateInfo[]> | undefined;

  function invalidate(reason: CacheInvalidationEvent["reason"]): void {
    if (cache === undefined) return; // nothing cached — nothing to invalidate
    cache = undefined;
    options.onCacheInvalidated?.({ cache: "templates", reason, at: now().toISOString() });
  }

  function listTemplates(): Promise<PolicyTemplateInfo[]> {
    if (cache !== undefined) return Promise.resolve(cache);
    if (inFlight) return inFlight;

    inFlight = client
      .listTemplates()
      .then((templates) => {
        cache = templates;
        return templates;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  }

  return {
    inner: client,
    listTemplates,
    refreshTemplates() {
      invalidate("explicit-refresh");
      return listTemplates();
    },
    async generate(definition) {
      const policy = await client.generate(definition);
      // Invalidate AFTER the mutation succeeds, not before: an invalidation
      // ahead of a generate() call that then fails would drop a perfectly
      // good cache for no reason.
      invalidate("template-update");
      return policy;
    },
  };
}
