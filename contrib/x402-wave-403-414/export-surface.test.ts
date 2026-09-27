import { describe, expect, it } from "vitest";
import * as experimentalExports from "../../src/experimental-exports";
import { EXPERIMENTAL_EXPORTS, STABLE_V1_EXPORTS } from "../../src/export-surface";
import * as v1Exports from "../../src/v1-exports";

/**
 * Rationale for Export Surface Allowlist Enforcement (#406):
 * Any public export present in the package root (v1-exports or experimental-exports) that is
 * missing from STABLE_V1_EXPORTS or EXPERIMENTAL_EXPORTS represents an undocumented or drifting
 * public export surface.
 *
 * We deliberately FAIL the test whenever an export present in code is absent from the declared allowlists.
 * Argued case: Allowing undeclared exports to pass silently would undermine the main goal of export-surface.ts,
 * which is to keep public API documentation and canonical export tracking in strict parity with implementation.
 * Every new export MUST be intentionally declared in export-surface.ts as either stable v1 or experimental.
 */
describe("export-surface allowlist enforcement (#406)", () => {
  it("compares actual stable v1 root exports against declared STABLE_V1_EXPORTS with a detailed diff", () => {
    const actualV1ExportNames = Object.keys(v1Exports);

    const missingExports = STABLE_V1_EXPORTS.filter((name) => !actualV1ExportNames.includes(name));
    const extraExports = actualV1ExportNames.filter(
      (name) => !STABLE_V1_EXPORTS.includes(name as any),
    );

    const diffMessage = [
      "Stable v1 export surface mismatch detected between v1-exports.ts and STABLE_V1_EXPORTS:",
      missingExports.length > 0
        ? `  Missing expected exports (${missingExports.length}): [${missingExports.join(", ")}]`
        : null,
      extraExports.length > 0
        ? `  Extra undeclared exports (${extraExports.length}): [${extraExports.join(", ")}]`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    expect(missingExports, diffMessage).toEqual([]);
    expect(extraExports, diffMessage).toEqual([]);
  });

  it("compares actual experimental exports against declared EXPERIMENTAL_EXPORTS with a detailed diff", () => {
    const actualExperimentalExportNames = Object.keys(experimentalExports);

    const missingExports = EXPERIMENTAL_EXPORTS.filter(
      (name) => !actualExperimentalExportNames.includes(name),
    );
    const extraExports = actualExperimentalExportNames.filter(
      (name) => !actualExperimentalExportNames.includes(name as any),
    );

    const diffMessage = [
      "Experimental export surface mismatch detected between experimental-exports.ts and EXPERIMENTAL_EXPORTS:",
      missingExports.length > 0
        ? `  Missing expected experimental exports (${missingExports.length}): [${missingExports.join(", ")}]`
        : null,
      extraExports.length > 0
        ? `  Extra undeclared experimental exports (${extraExports.length}): [${extraExports.join(", ")}]`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    expect(missingExports, diffMessage).toEqual([]);
    expect(extraExports, diffMessage).toEqual([]);
  });
});
