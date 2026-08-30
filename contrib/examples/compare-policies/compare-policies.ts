// Example: compare two PolicyDefinition objects field by field and report
// whether they are equivalent, ignoring the order of array-valued fields
// (owners, allowlistedContracts) — two policies listing the same owners in
// a different order are still the same policy.
//
// Run with: npx tsx compare-policies.ts

import type { PolicyDefinition } from "../../../src/types";

function sameStringSet(a: string[] = [], b: string[] = []): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, i) => value === sortedB[i]);
}

function sameSpendingLimits(
  a?: PolicyDefinition["spendingLimits"],
  b?: PolicyDefinition["spendingLimits"],
): boolean {
  return (a?.dailyXlm ?? undefined) === (b?.dailyXlm ?? undefined)
    && (a?.perTxXlm ?? undefined) === (b?.perTxXlm ?? undefined);
}

function sameTimelocks(a?: PolicyDefinition["timelocks"], b?: PolicyDefinition["timelocks"]): boolean {
  return (a?.adminActionDelaySeconds ?? undefined) === (b?.adminActionDelaySeconds ?? undefined);
}

/**
 * Reports whether `a` and `b` describe the same policy: every scalar field
 * matches exactly, and `owners`/`allowlistedContracts` match as sets (order
 * doesn't matter, duplicates and length do).
 */
export function policiesEqual(a: PolicyDefinition, b: PolicyDefinition): boolean {
  return (
    a.version === b.version &&
    a.type === b.type &&
    a.threshold === b.threshold &&
    sameStringSet(a.owners, b.owners) &&
    sameStringSet(a.allowlistedContracts, b.allowlistedContracts) &&
    sameSpendingLimits(a.spendingLimits, b.spendingLimits) &&
    sameTimelocks(a.timelocks, b.timelocks)
  );
}

function main() {
  const policyA: PolicyDefinition = {
    version: "1",
    type: "spending-limit",
    owners: ["GALICE", "GBOB"],
    threshold: 2,
    spendingLimits: { dailyXlm: "500", perTxXlm: "200" },
  };

  // Same policy, owners listed in the opposite order — still equal.
  const policyB: PolicyDefinition = {
    ...policyA,
    owners: ["GBOB", "GALICE"],
  };

  // A genuinely different policy — different threshold.
  const policyC: PolicyDefinition = {
    ...policyA,
    threshold: 1,
  };

  console.log(`policyA vs policyB (owners reordered): ${policiesEqual(policyA, policyB)}`);
  console.log(`policyA vs policyC (different threshold): ${policiesEqual(policyA, policyC)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
