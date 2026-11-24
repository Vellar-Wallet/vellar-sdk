// Client-side catalog durability probe (issue #873). Reference implementation
// under contrib/ because external PRs may only change that directory.
//
// The facilitator does not expose CATALOG_DB_URL to clients. This helper
// infers durability from an OBSERVED signal only: a resource whose trust
// metadata reports `statsSource: "persisted"` must have been restored from a
// durable catalog. The absence of that signal is inconclusive, not proof of an
// in-memory catalog, because a fresh catalog may simply have no resources yet.

/** A resource shape narrow enough to work with any discovery representation. */
export interface ResourceWithTrust {
  trust?: { statsSource?: string };
  statsSource?: string;
}

export type DurabilityVerdict = "durable" | "inconclusive";

export interface DurabilityProbeResult {
  verdict: DurabilityVerdict;
  /** Human-readable explanation, including the inference limitation. */
  reason: string;
  /** Index of the first resource that supplied evidence, when there is one. */
  evidenceIndex?: number;
}

/** Infer catalog durability from a discovery response.
 *
 * Single pass with early exit on the first persisted `statsSource`. Returns
 * only `durable` or `inconclusive`. It deliberately never returns `false` or
 * `in-memory`: absence of evidence is not evidence of absence.
 */
export function probeCatalogDurability(
  resources: readonly ResourceWithTrust[],
): DurabilityProbeResult {
  for (let i = 0; i < resources.length; i++) {
    const resource = resources[i]!;
    const statsSource = resource.trust?.statsSource ?? resource.statsSource;
    if (statsSource === "persisted") {
      return {
        verdict: "durable",
        reason:
          `Resource ${i} reports statsSource=persisted, which is evidence of a ` +
          `libSQL-backed durable catalog. This is an inference from observed ` +
          `behavior, not a direct read of the facilitator's CATALOG_DB_URL.`,
        evidenceIndex: i,
      };
    }
  }

  return {
    verdict: "inconclusive",
    reason:
      `No resource in this discovery response reports statsSource=persisted. ` +
      `That could mean an in-memory catalog, or simply that no resource has been ` +
      `observed and restored yet. This is an inference from observed behavior, ` +
      `not a direct read of CATALOG_DB_URL, so it is inconclusive rather than false.`,
  };
}
