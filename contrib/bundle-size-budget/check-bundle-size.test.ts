/**
 * REFERENCE TEST IMPLEMENTATION for issue #684.
 * Copy/adapt into scripts/check-bundle-size.test.ts.
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkBundleSizes } from "./check-bundle-size.mjs";

function makeFixtureDist(totalBytes: number): string {
  const dir = mkdtempSync(path.join(tmpdir(), "bundle-size-fixture-"));
  const distDir = path.join(dir, "dist");
  mkdirSync(distDir, { recursive: true });
  writeFileSync(path.join(distDir, "index.js"), "x".repeat(totalBytes), "utf8");
  return dir;
}

describe("checkBundleSizes (#684)", () => {
  it("passes when a package's dist size is under its budget", () => {
    const baseDir = makeFixtureDist(10 * 1024); // 10KB
    const results = checkBundleSizes({ pkg: { distPath: "dist", budgetKb: 50 } }, baseDir);

    expect(results).toHaveLength(1);
    expect(results[0].overBudget).toBe(false);
  });

  it("fails (overBudget: true) when a package's dist size exceeds its budget", () => {
    const baseDir = makeFixtureDist(100 * 1024); // 100KB
    const results = checkBundleSizes({ pkg: { distPath: "dist", budgetKb: 50 } }, baseDir);

    expect(results).toHaveLength(1);
    expect(results[0].overBudget).toBe(true);
  });

  it("names the specific package and reports the measured size when over budget", () => {
    const baseDir = makeFixtureDist(100 * 1024);
    const results = checkBundleSizes(
      { "mcp-x402-payer": { distPath: "dist", budgetKb: 50 } },
      baseDir,
    );

    expect(results[0].name).toBe("mcp-x402-payer");
    expect(results[0].measuredKb).toBeGreaterThan(50);
  });

  it("skips (does not fail) a package whose dist directory does not exist yet", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bundle-size-empty-"));
    const results = checkBundleSizes({ pkg: { distPath: "dist", budgetKb: 50 } }, dir);

    expect(results[0].measuredBytes).toBeUndefined();
    expect(results[0].overBudget).toBe(false);
    expect(results[0].skippedReason).toBeDefined();
  });

  it("measures multiple files under dist/, including nested directories", () => {
    const baseDir = makeFixtureDist(1024);
    mkdirSync(path.join(baseDir, "dist", "nested"), { recursive: true });
    writeFileSync(
      path.join(baseDir, "dist", "nested", "chunk.js"),
      "y".repeat(2048),
      "utf8",
    );

    const results = checkBundleSizes({ pkg: { distPath: "dist", budgetKb: 50 } }, baseDir);

    // 1024 (index.js) + 2048 (nested/chunk.js) = 3072 bytes = 3KB.
    expect(results[0].measuredKb).toBeCloseTo(3, 1);
  });
});
