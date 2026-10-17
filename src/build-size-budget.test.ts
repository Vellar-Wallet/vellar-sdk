import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_BUILD_SIZE_BUDGETS,
  evaluateBuildSizeBudgets,
  formatBuildSizeReport,
  type PackageSizeBudget,
} from "./build-size-budget";

function createFakeWorkspace(
  sizes: Record<string, Record<string, number>>
): string {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vellar-size-budget-"));
  for (const [pkgDir, files] of Object.entries(sizes)) {
    const distDir = path.join(tmpRoot, pkgDir, "dist");
    fs.mkdirSync(distDir, { recursive: true });
    for (const [fileName, byteLength] of Object.entries(files)) {
      const filePath = path.join(distDir, fileName);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, "x".repeat(byteLength), "utf8");
    }
  }
  return tmpRoot;
}

describe("Workspace build-size regression budget (#684)", () => {
  it("keeps scripts/build-size-budgets.json aligned with DEFAULT_BUILD_SIZE_BUDGETS for all 3 workspace packages", () => {
    const configPath = path.join(
      process.cwd(),
      "scripts",
      "build-size-budgets.json"
    );
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      budgets: PackageSizeBudget[];
    };
    expect(parsed.budgets.map((b) => b.packageName)).toEqual([
      "vellar-sdk",
      "vellar-cli",
      "vellar-mcp-x402-payer",
    ]);
    expect(DEFAULT_BUILD_SIZE_BUDGETS.map((b) => b.packageName)).toEqual([
      "vellar-sdk",
      "vellar-cli",
      "vellar-mcp-x402-payer",
    ]);
  });

  it("passes when all three workspace packages are within their total and per-file runtime budgets (ignoring sourcemaps and d.ts)", () => {
    const fakeRoot = createFakeWorkspace({
      ".": {
        "index.js": 60_000,
        "index.cjs": 62_000,
        "index.d.ts": 90_000,
        "index.js.map": 500_000,
      },
      "packages/cli": {
        "index.js": 15_000,
        "bin.js": 18_000,
        "index.js.map": 120_000,
      },
      "packages/mcp-x402-payer": {
        "index.js": 28_000,
        "bin.js": 29_000,
        "index.d.ts": 45_000,
      },
    });

    try {
      const evaluation = evaluateBuildSizeBudgets(fakeRoot);
      expect(evaluation.passed).toBe(true);
      expect(evaluation.errors).toHaveLength(0);

      const sdkRes = evaluation.results.find(
        (r) => r.budget.packageName === "vellar-sdk"
      )!;
      expect(sdkRes.measurement.runtimeBytes).toBe(122_000);
      expect(sdkRes.measurement.typesBytes).toBe(90_000);
      expect(sdkRes.measurement.sourcemapBytes).toBe(500_000);

      const report = formatBuildSizeReport(evaluation);
      expect(report).toContain("[PASS] vellar-sdk");
      expect(report).toContain("[PASS] vellar-cli");
      expect(report).toContain("[PASS] vellar-mcp-x402-payer");
    } finally {
      fs.rmSync(fakeRoot, { recursive: true, force: true });
    }
  });

  it("fails with a clear message naming the package and exact byte overage when a package exceeds its budget", () => {
    const fakeRoot = createFakeWorkspace({
      ".": {
        "index.js": 100_000,
      },
      "packages/cli": {
        "index.js": 45_000,
        "bin.js": 50_000, // combined 95,000 B > 81,920 B budget (over by 13,080 B)
      },
      "packages/mcp-x402-payer": {
        "index.js": 90_000, // single file 90,000 B > 81,920 B maxSingleFileBytes (over by 8,080 B)
      },
    });

    try {
      const evaluation = evaluateBuildSizeBudgets(fakeRoot);
      expect(evaluation.passed).toBe(false);

      const cliRes = evaluation.results.find(
        (r) => r.budget.packageName === "vellar-cli"
      )!;
      expect(cliRes.passed).toBe(false);
      expect(cliRes.exceededTotalByBytes).toBe(13_080);
      expect(cliRes.errors[0]).toContain('Package "vellar-cli" exceeded its total dist runtime budget by 13080 B');

      const mcpRes = evaluation.results.find(
        (r) => r.budget.packageName === "vellar-mcp-x402-payer"
      )!;
      expect(mcpRes.passed).toBe(false);
      expect(mcpRes.exceededSingleFileByBytes).toBe(8_080);
      expect(mcpRes.errors[0]).toContain('Package "vellar-mcp-x402-payer" chunk "index.js" exceeded maxSingleFileBytes by 8080 B');

      const report = formatBuildSizeReport(evaluation);
      expect(report).toContain("[FAIL] vellar-cli");
      expect(report).toContain("[FAIL] vellar-mcp-x402-payer");
    } finally {
      fs.rmSync(fakeRoot, { recursive: true, force: true });
    }
  });

  it("fails when a package dist directory is missing", () => {
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vellar-empty-"));
    try {
      const evaluation = evaluateBuildSizeBudgets(emptyRoot);
      expect(evaluation.passed).toBe(false);
      expect(evaluation.errors).toHaveLength(3);
      expect(evaluation.errors[0]).toContain("has no build output");
    } finally {
      fs.rmSync(emptyRoot, { recursive: true, force: true });
    }
  });
});
