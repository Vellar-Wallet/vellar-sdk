// Example: preview what an old-style (pre-v1) policy configuration would
// look like migrated to the current PolicyDefinition shape (src/types.ts),
// without applying anything. Reports any old fields that have no
// equivalent in the new shape, so a caller can decide what to do with them
// before actually migrating.
//
// Field mapping (documented — see the README for the full table):
//   policyOwner (string)     -> owners (string[], wrapped in an array)
//   dailyLimit                -> spendingLimits.dailyXlm
//   perTxLimit                -> spendingLimits.perTxXlm
//   allowedContracts           -> allowlistedContracts
//   adminDelaySeconds          -> timelocks.adminActionDelaySeconds
//   legacyFlag, notes          -> no equivalent (reported as unmapped)
//
// Run with: npx tsx policy-migration-dry-run.ts

import type { PolicyDefinition } from "../../../src/types";

export interface OldPolicyConfig {
  policyOwner: string;
  dailyLimit?: string;
  perTxLimit?: string;
  allowedContracts?: string[];
  adminDelaySeconds?: number;
  /** No longer meaningful — every policy is versioned by contract wasm now. */
  legacyFlag?: boolean;
  /** Free-text notes had no structured home in the old shape either; still none in the new one. */
  notes?: string;
}

export interface MigrationPreview {
  preview: PolicyDefinition;
  unmappedFields: string[];
}

const MAPPED_OLD_FIELDS = new Set([
  "policyOwner",
  "dailyLimit",
  "perTxLimit",
  "allowedContracts",
  "adminDelaySeconds",
]);

/** Builds a preview of the migrated PolicyDefinition, plus a list of old
 * fields that had no equivalent and were dropped. Does not mutate or
 * persist anything — purely a dry-run preview. */
export function previewMigration(old: OldPolicyConfig): MigrationPreview {
  const preview: PolicyDefinition = {
    version: "1",
    type: "spending-limit",
    owners: [old.policyOwner],
  };

  if (old.dailyLimit !== undefined || old.perTxLimit !== undefined) {
    preview.spendingLimits = {
      ...(old.dailyLimit !== undefined && { dailyXlm: old.dailyLimit }),
      ...(old.perTxLimit !== undefined && { perTxXlm: old.perTxLimit }),
    };
  }
  if (old.allowedContracts !== undefined) {
    preview.allowlistedContracts = old.allowedContracts;
  }
  if (old.adminDelaySeconds !== undefined) {
    preview.timelocks = { adminActionDelaySeconds: old.adminDelaySeconds };
  }

  const unmappedFields = Object.entries(old)
    .filter(([key, value]) => !MAPPED_OLD_FIELDS.has(key) && value !== undefined)
    .map(([key]) => key);

  return { preview, unmappedFields };
}

function main() {
  const sampleOldConfig: OldPolicyConfig = {
    policyOwner: "GOWNERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    dailyLimit: "100",
    perTxLimit: "20",
    allowedContracts: ["CUSDCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
    adminDelaySeconds: 3600,
    legacyFlag: true,
    notes: "Migrated from the v0 policy service",
  };

  const { preview, unmappedFields } = previewMigration(sampleOldConfig);
  console.log("Migration preview:", preview);
  console.log();
  console.log("Unmapped fields (dropped, no equivalent in the new shape):", unmappedFields);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
