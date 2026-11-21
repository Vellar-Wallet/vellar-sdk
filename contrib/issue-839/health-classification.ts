/**
 * Catalog health classification for the facilitator `/health` response (#839).
 *
 * `/health` carries two catalog-related counters that look alike but mean
 * different things (see `website/content/docs/operators/limits.md`):
 *
 *  - `reverifyPending` — ownership re-verification checks still in flight
 *    after a restart. This is TRANSIENT: it drains to `0` on its own, so the
 *    right response is to wait and re-check.
 *  - `unverifiableEntries` — entries whose URLs can structurally never be
 *    verified (http, loopback, route template). This is PERMANENT: waiting
 *    never fixes it, the entries themselves have to change. The field is
 *    ABSENT when zero (documented), and absence is treated as `0`.
 *
 * A consumer-facing summary must never fold the two into one generic "catalog
 * trouble" flag: a restart that is merely settling would look permanently
 * broken, or a permanent problem would be dismissed as "still settling". Both
 * can also be true at once, and then BOTH are reported — neither masks the
 * other.
 *
 * This builds on `parseHealthResponse` / `HealthResponse` from `src/health.ts`
 * and does not change them.
 */

import { parseHealthResponse, type HealthResponse } from "../../src/health";

/** The two distinct named classifications. */
export type CatalogIssue = "transiently-settling" | "permanent-unverifiable";

/** Overall state, derived from which classifications apply. */
export type CatalogHealthState =
  | "healthy"
  | "settling"
  | "permanent-issue"
  | "settling-with-permanent-issue";

export interface CatalogHealthSummary {
  state: CatalogHealthState;
  /** Every classification that applies; empty when healthy. */
  issues: CatalogIssue[];
  /** TRANSIENT: re-verification checks still draining. */
  transient: {
    settling: boolean;
    /** The `reverifyPending` reading. */
    pending: number;
  };
  /** PERMANENT: entries that can never be verified. */
  permanent: {
    unverifiable: boolean;
    /** The `unverifiableEntries` reading (`0` when the field was absent). */
    count: number;
  };
  /** What an operator should do, per classification. */
  guidance: string[];
}

/** The two fields this helper reads. `unverifiableEntries` may be absent. */
export type CatalogHealthInput = Pick<HealthResponse, "reverifyPending"> & {
  unverifiableEntries?: number;
};

function assertCount(name: string, value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `Invalid catalog health: \`${name}\` must be a non-negative number, got ${String(value)}`,
    );
  }
}

/**
 * Classify the catalog state from the two `/health` counters.
 *
 * Only `reverifyPending > 0` => `transiently-settling`.
 * Only `unverifiableEntries > 0` => `permanent-unverifiable`.
 * Both => both are reported (state `settling-with-permanent-issue`).
 * Neither => `healthy`.
 *
 * An absent `unverifiableEntries` means zero, never an error. A guaranteed
 * field that is missing or negative throws, matching `parseHealthResponse`.
 */
export function classifyCatalogHealth(input: CatalogHealthInput): CatalogHealthSummary {
  assertCount("reverifyPending", input.reverifyPending);
  const unverifiable = input.unverifiableEntries ?? 0;
  assertCount("unverifiableEntries", unverifiable);

  const settling = input.reverifyPending > 0;
  const permanent = unverifiable > 0;

  const issues: CatalogIssue[] = [];
  const guidance: string[] = [];
  if (settling) {
    issues.push("transiently-settling");
    guidance.push(
      `${input.reverifyPending} ownership re-verification check(s) are still in flight after a restart. This clears on its own: wait and re-check.`,
    );
  }
  if (permanent) {
    issues.push("permanent-unverifiable");
    guidance.push(
      `${unverifiable} catalog entr${unverifiable === 1 ? "y" : "ies"} can structurally never be verified (http, loopback or route-template URLs). Waiting will not fix this: correct or remove the entries.`,
    );
  }

  const state: CatalogHealthState =
    settling && permanent
      ? "settling-with-permanent-issue"
      : settling
        ? "settling"
        : permanent
          ? "permanent-issue"
          : "healthy";

  return {
    state,
    issues,
    transient: { settling, pending: input.reverifyPending },
    permanent: { unverifiable: permanent, count: unverifiable },
    guidance,
  };
}

/** Parse a raw `/health` body with the SDK parser, then classify it. */
export function classifyHealthResponse(raw: unknown): CatalogHealthSummary {
  return classifyCatalogHealth(parseHealthResponse(raw));
}
