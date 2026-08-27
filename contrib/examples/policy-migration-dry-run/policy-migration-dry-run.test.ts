import { describe, expect, it } from "vitest";
import { previewMigration } from "./policy-migration-dry-run";

describe("previewMigration", () => {
  it("wraps policyOwner in the owners array", () => {
    const { preview } = previewMigration({ policyOwner: "GOWNER" });
    expect(preview.owners).toEqual(["GOWNER"]);
    expect(preview.version).toBe("1");
    expect(preview.type).toBe("spending-limit");
  });

  it("maps dailyLimit/perTxLimit into spendingLimits", () => {
    const { preview } = previewMigration({ policyOwner: "GOWNER", dailyLimit: "100", perTxLimit: "20" });
    expect(preview.spendingLimits).toEqual({ dailyXlm: "100", perTxXlm: "20" });
  });

  it("maps allowedContracts into allowlistedContracts", () => {
    const { preview } = previewMigration({ policyOwner: "GOWNER", allowedContracts: ["CUSDC"] });
    expect(preview.allowlistedContracts).toEqual(["CUSDC"]);
  });

  it("maps adminDelaySeconds into timelocks", () => {
    const { preview } = previewMigration({ policyOwner: "GOWNER", adminDelaySeconds: 3600 });
    expect(preview.timelocks).toEqual({ adminActionDelaySeconds: 3600 });
  });

  it("reports fields with no equivalent in the new shape", () => {
    const { unmappedFields } = previewMigration({
      policyOwner: "GOWNER",
      legacyFlag: true,
      notes: "some notes",
    });
    expect(unmappedFields).toEqual(["legacyFlag", "notes"]);
  });

  it("reports no unmapped fields when only mapped fields are present", () => {
    const { unmappedFields } = previewMigration({ policyOwner: "GOWNER", dailyLimit: "100" });
    expect(unmappedFields).toEqual([]);
  });

  it("omits spendingLimits/allowlistedContracts/timelocks entirely when the old config lacks them", () => {
    const { preview } = previewMigration({ policyOwner: "GOWNER" });
    expect(preview.spendingLimits).toBeUndefined();
    expect(preview.allowlistedContracts).toBeUndefined();
    expect(preview.timelocks).toBeUndefined();
  });
});
