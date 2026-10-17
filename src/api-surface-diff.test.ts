import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  extractPublicApiSurface,
  diffApiSurface,
  verifyBreakingChangesAgainstChangelog,
  type ApiSurfaceSnapshot,
} from "./api-surface-diff";

describe("API surface diff check (#686)", () => {
  const rootDir = process.cwd();
  const baselinePath = path.join(rootDir, "scripts", "api-surface-baseline.json");
  const baseline: ApiSurfaceSnapshot = JSON.parse(
    fs.readFileSync(baselinePath, "utf8")
  );

  it("extracts the full public runtime and type surface from src/index.ts matching baseline", () => {
    const current = extractPublicApiSurface({
      rootDir,
      entryFile: "src/index.ts",
      version: baseline.version,
    });

    expect(Object.keys(current.exports).length).toBeGreaterThanOrEqual(170);
    expect(current.exports.createVellarWallet).toBeDefined();
    expect(current.exports.createVellarWallet.kind).toBe("function");
    expect(current.exports.NetworkConfig).toBeDefined();
    expect(current.exports.NetworkConfig.isType).toBe(true);

    const diff = diffApiSurface(baseline, current);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diff.hasBreakingChanges).toBe(false);
  });

  it("allows purely additive exports without requiring a breaking changelog entry", () => {
    const current: ApiSurfaceSnapshot = {
      ...baseline,
      version: "0.6.3",
      exports: {
        ...baseline.exports,
        newHelperFunction: {
          name: "newHelperFunction",
          kind: "function",
          isValue: true,
          isType: false,
          signature: "(input: string) => boolean",
        },
      },
    };

    const diff = diffApiSurface(baseline, current);
    expect(diff.added.map((a) => a.name)).toEqual(["newHelperFunction"]);
    expect(diff.removed).toHaveLength(0);
    expect(diff.hasBreakingChanges).toBe(false);

    const verification = verifyBreakingChangesAgainstChangelog(
      diff,
      "# Changelog\n\n## 0.6.3 — 2026-10-17\n\n### Added\n- General improvements.\n"
    );
    expect(verification.passed).toBe(true);
  });

  it("flags removed exports and breaking signature changes and fails when undocumented in CHANGELOG.md", () => {
    const mutatedExports = { ...baseline.exports };
    delete mutatedExports.createVellarWallet;
    mutatedExports.formatTokenAmount = {
      ...mutatedExports.formatTokenAmount,
      signature: "(rawAmount: bigint) => number",
    };

    const current: ApiSurfaceSnapshot = {
      ...baseline,
      version: "0.7.0",
      exports: mutatedExports,
    };

    const diff = diffApiSurface(baseline, current);
    expect(diff.hasBreakingChanges).toBe(true);
    expect(diff.removed.map((r) => r.name)).toEqual(["createVellarWallet"]);
    expect(diff.changed.map((c) => c.name)).toEqual(["formatTokenAmount"]);
    expect(diff.breakingSymbols).toEqual([
      "createVellarWallet",
      "formatTokenAmount",
    ]);

    // Undocumented in CHANGELOG.md -> fails
    const undocumentedChangelog =
      "# Changelog\n\n## 0.7.0 — 2026-10-17\n\n### Added\n- Minor internal refactor.\n";
    const failedCheck = verifyBreakingChangesAgainstChangelog(
      diff,
      undocumentedChangelog
    );
    expect(failedCheck.passed).toBe(false);
    expect(failedCheck.undocumentedBreakingSymbols).toEqual([
      "createVellarWallet",
      "formatTokenAmount",
    ]);

    // Documented in latest section of CHANGELOG.md -> passes
    const documentedChangelog =
      "# Changelog\n\n## 0.7.0 — 2026-10-17\n\n### Breaking\n- Removed `createVellarWallet` and updated `formatTokenAmount` return type.\n";
    const passedCheck = verifyBreakingChangesAgainstChangelog(
      diff,
      documentedChangelog
    );
    expect(passedCheck.passed).toBe(true);
    expect(passedCheck.documentedBreakingSymbols).toEqual([
      "createVellarWallet",
      "formatTokenAmount",
    ]);

    // Explicit acknowledgment flag -> passes even when undocumented
    const ackCheck = verifyBreakingChangesAgainstChangelog(
      diff,
      undocumentedChangelog,
      { acknowledgeBreaking: true }
    );
    expect(ackCheck.passed).toBe(true);
    expect(ackCheck.acknowledgedViaFlag).toBe(true);
  });
});
