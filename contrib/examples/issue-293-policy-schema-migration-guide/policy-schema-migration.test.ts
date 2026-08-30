import { describe, expect, it } from "vitest";
import {
  CURRENT_POLICY_SCHEMA_VERSION,
  detectSchemaVersion,
  migratePolicyToCurrent,
  stampCurrentVersion,
  type PolicyV1,
} from "./policy-schema-migration";

// Fixture: a policy blob as it would have been written to local storage by
// an older consumer, before schemaVersion existed at all.
const legacyFixture: PolicyV1 = {
  policyOwner: "GOWNERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  dailyLimit: "100",
  perTxLimit: "20",
  allowlistedContracts: ["CUSDCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
};

describe("detectSchemaVersion", () => {
  it("treats a blob with no schemaVersion field as v1", () => {
    expect(detectSchemaVersion(legacyFixture)).toBe(1);
  });

  it("treats an explicit schemaVersion: 1 as v1", () => {
    expect(detectSchemaVersion({ ...legacyFixture, schemaVersion: 1 })).toBe(1);
  });

  it("detects a current v2 blob", () => {
    expect(
      detectSchemaVersion({
        schemaVersion: 2,
        owners: [legacyFixture.policyOwner],
        spendingLimits: { dailyXlm: "100", perTxXlm: "20" },
        allowlistedContracts: legacyFixture.allowlistedContracts,
      }),
    ).toBe(2);
  });

  it("rejects an unrecognized schemaVersion", () => {
    expect(() => detectSchemaVersion({ schemaVersion: 99 })).toThrow(RangeError);
  });

  it("rejects a non-object value", () => {
    expect(() => detectSchemaVersion(null)).toThrow(TypeError);
    expect(() => detectSchemaVersion("not an object")).toThrow(TypeError);
  });
});

describe("migratePolicyToCurrent — documented migration steps against the fixture", () => {
  it("wraps the single owner string into the owners array", () => {
    const migrated = migratePolicyToCurrent(legacyFixture);
    expect(migrated.owners).toEqual([legacyFixture.policyOwner]);
  });

  it("nests dailyLimit/perTxLimit under spendingLimits", () => {
    const migrated = migratePolicyToCurrent(legacyFixture);
    expect(migrated.spendingLimits).toEqual({ dailyXlm: "100", perTxXlm: "20" });
  });

  it("carries allowlistedContracts through unchanged", () => {
    const migrated = migratePolicyToCurrent(legacyFixture);
    expect(migrated.allowlistedContracts).toEqual(legacyFixture.allowlistedContracts);
  });

  it("stamps schemaVersion 2 on the migrated result", () => {
    const migrated = migratePolicyToCurrent(legacyFixture);
    expect(migrated.schemaVersion).toBe(CURRENT_POLICY_SCHEMA_VERSION);
  });

  it("is idempotent — migrating an already-current blob returns it unchanged", () => {
    const once = migratePolicyToCurrent(legacyFixture);
    const twice = migratePolicyToCurrent(once);
    expect(twice).toEqual(once);
  });
});

describe("stampCurrentVersion", () => {
  it("attaches the current schema version to a freshly built policy", () => {
    const stamped = stampCurrentVersion({
      owners: [legacyFixture.policyOwner],
      spendingLimits: { dailyXlm: "100", perTxXlm: "20" },
      allowlistedContracts: legacyFixture.allowlistedContracts,
    });
    expect(stamped.schemaVersion).toBe(CURRENT_POLICY_SCHEMA_VERSION);
    expect(detectSchemaVersion(stamped)).toBe(2);
  });
});
