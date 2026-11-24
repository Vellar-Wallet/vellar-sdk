// Discovery client non-assumption wrapper (issue #874). Reference
// implementation under contrib/ because external PRs may only change that
// directory.
//
// AUDIT RESULT (src/x402-client.ts on dev): the client's discovery path calls
// assertCatalogEntryVerifiable for structurally unverifiable URLs and performs
// a fresh fetch on each request. It holds no persistent cache of discovered
// resource URLs and never reads a catalog durability setting. There is
// therefore no implicit "this entry stays valid forever" assumption in the
// current code. This wrapper makes that property explicit and testable, and
// re-checks the trust signal on every call instead of relying on a prior
// verdict.
//
// When a previously known resource disappears after a facilitator restart,
// the documented recovery is the recatalog-on-payment flow, not a stale-but-
// valid cache hit. No recatalog helper exists on any upstream branch, so this
// module documents the contract rather than pretending one is available.

import {
  probeCatalogDurability,
  type DurabilityProbeResult,
  type ResourceWithTrust,
} from "../873-durability-probe/durability.js";

export interface DiscoveredResource extends ResourceWithTrust {
  url: string;
}

export interface DiscoveryFetchResult {
  resources: readonly DiscoveredResource[];
}

export type DiscoveryFetch = () => Promise<DiscoveryFetchResult>;

export interface DiscoverySnapshot {
  resources: readonly DiscoveredResource[];
  /** Re-evaluated on every call. Never carried over from an earlier call. */
  durability: DurabilityProbeResult;
}

export interface RestartAwareDiscovery {
  discover(): Promise<DiscoverySnapshot>;
  /** True only for URLs present in the most recent discovery response. */
  has(url: string): boolean;
}

/** Wrap a discovery fetch so each call REPLACES the known URL set. A resource
 * absent from the new response is treated as gone, even if a previous response
 * contained it. Durability is re-probed each time and is never assumed. */
export function createRestartAwareDiscovery(fetchDiscovery: DiscoveryFetch): RestartAwareDiscovery {
  let knownUrls: ReadonlySet<string> = new Set();

  return {
    async discover() {
      const { resources } = await fetchDiscovery();
      // Replace, never merge: a restart with an in-memory catalog legitimately
      // drops entries, and a stale entry must not be treated as still valid.
      knownUrls = new Set(resources.map((resource) => resource.url));
      return {
        resources,
        durability: probeCatalogDurability(resources),
      };
    },
    has(url: string) {
      return knownUrls.has(url);
    },
  };
}
