// Example: detect and migrate a locally cached PolicyDefinition that was
// written to storage by an older version of a consuming app, following the
// same versioned-migration shape used for session storage (see
// src/session.ts's SessionStorageAdapter: load() returns null/throws are
// treated as "nothing usable", never a crash).
//
// Cached policy blobs have no version tag today, so a consumer opting into
// this pattern should start stamping a `schemaVersion` field going forward
// (see `stampCurrentVersion` below) and use `detectSchemaVersion` to handle
// whatever was written before that started.
//
// Run with: npx tsx policy-schema-migration.ts

export const CURRENT_POLICY_SCHEMA_VERSION = 2;

/** v1 shape: a single string owner, flat limit fields. Predates
 * `owners: string[]` and the nested `spendingLimits` object. */
export interface PolicyV1 {
  schemaVersion?: 1; // absent on the very first cached shape, pre-dating the field itself
  policyOwner: string;
  dailyLimit: string;
  perTxLimit: string;
  allowlistedContracts: string[];
}

/** v2 (current) shape, mirroring src/types.ts PolicyDefinition's structure. */
export interface PolicyV2 {
  schemaVersion: 2;
  owners: string[];
  spendingLimits: { dailyXlm: string; perTxXlm: string };
  allowlistedContracts: string[];
}

export type StoredPolicy = PolicyV1 | PolicyV2;

/**
 * Detects the schema version of a cached policy blob. Unversioned blobs
 * (no `schemaVersion` field at all) are assumed v1, since that was the only
 * shape ever written before versioning was introduced.
 */
export function detectSchemaVersion(cached: unknown): 1 | 2 {
  if (typeof cached !== "object" || cached === null) {
    throw new TypeError("Cached policy is not an object — cannot detect schema version");
  }
  const version = (cached as { schemaVersion?: unknown }).schemaVersion;
  if (version === 2) return 2;
  if (version === 1 || version === undefined) return 1;
  throw new RangeError(`Unrecognized policy schemaVersion: ${String(version)}`);
}

function migratePolicyV1ToV2(v1: PolicyV1): PolicyV2 {
  return {
    schemaVersion: 2,
    owners: [v1.policyOwner],
    spendingLimits: { dailyXlm: v1.dailyLimit, perTxXlm: v1.perTxLimit },
    allowlistedContracts: v1.allowlistedContracts,
  };
}

/**
 * Migrates a cached policy blob of unknown vintage up to the current schema.
 * Idempotent — calling it on an already-current blob returns it unchanged.
 */
export function migratePolicyToCurrent(cached: unknown): PolicyV2 {
  const version = detectSchemaVersion(cached);
  if (version === 2) return cached as PolicyV2;
  return migratePolicyV1ToV2(cached as PolicyV1);
}

/** Stamps the current schema version onto a policy before writing it back to
 * storage, so future reads can detect its version directly. */
export function stampCurrentVersion(policy: Omit<PolicyV2, "schemaVersion">): PolicyV2 {
  return { ...policy, schemaVersion: CURRENT_POLICY_SCHEMA_VERSION };
}

function main() {
  const legacyCached: unknown = {
    policyOwner: "GOWNERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    dailyLimit: "100",
    perTxLimit: "20",
    allowlistedContracts: ["CUSDCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
  };

  console.log("Detected version:", detectSchemaVersion(legacyCached));
  const migrated = migratePolicyToCurrent(legacyCached);
  console.log("Migrated:", migrated);
  console.log(
    "Re-running migration on already-current data is a no-op:",
    migratePolicyToCurrent(migrated),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
