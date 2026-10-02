// Tests for bundle-size-check.ts (#445)
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  checkForbiddenImports,
  measureBundleSize,
  checkBudget,
  formatSize,
  type BundleBudget,
} from "./bundle-size-check.js";

describe("bundle-size-check (#445)", () => {
  const testDir = join(process.cwd(), "test-bundle-dist");

  function setupTestDist() {
    mkdirSync(testDir, { recursive: true });
  }

  function teardownTestDist() {
    rmSync(testDir, { recursive: true, force: true });
  }

  describe("checkForbiddenImports", () => {
    it("detects forbidden imports in various patterns", () => {
      setupTestDist();
      const testFile = join(testDir, "test.js");

      // ESM import
      writeFileSync(testFile, 'import { Server } from "@stellar/stellar-sdk";');
      expect(checkForbiddenImports(testFile, ["@stellar/stellar-sdk"])).toEqual([
        "@stellar/stellar-sdk",
      ]);

      // CJS require
      writeFileSync(testFile, 'const sdk = require("@stellar/stellar-sdk");');
      expect(checkForbiddenImports(testFile, ["@stellar/stellar-sdk"])).toEqual([
        "@stellar/stellar-sdk",
      ]);

      // Dynamic import
      writeFileSync(testFile, 'const mod = await import("@stellar/stellar-sdk");');
      expect(checkForbiddenImports(testFile, ["@stellar/stellar-sdk"])).toEqual([
        "@stellar/stellar-sdk",
      ]);

      teardownTestDist();
    });

    it("returns empty array when no forbidden imports found", () => {
      setupTestDist();
      const testFile = join(testDir, "clean.js");
      writeFileSync(testFile, 'import { something } from "./local";');

      expect(checkForbiddenImports(testFile, ["@stellar/stellar-sdk"])).toEqual([]);
      teardownTestDist();
    });

    it("detects multiple forbidden imports", () => {
      setupTestDist();
      const testFile = join(testDir, "multi.js");
      writeFileSync(
        testFile,
        'import { Server } from "@stellar/stellar-sdk";\nimport sdk from "vellar-sdk";',
      );

      const violations = checkForbiddenImports(testFile, ["@stellar/stellar-sdk", "vellar-sdk"]);
      expect(violations).toHaveLength(2);
      expect(violations).toContain("@stellar/stellar-sdk");
      expect(violations).toContain("vellar-sdk");

      teardownTestDist();
    });
  });

  describe("measureBundleSize", () => {
    it("sums sizes of multiple files", () => {
      setupTestDist();
      writeFileSync(join(testDir, "file1.js"), "a".repeat(1000));
      writeFileSync(join(testDir, "file2.cjs"), "b".repeat(2000));

      const result = measureBundleSize(testDir, ["file1.js", "file2.cjs"]);
      expect(result.totalSize).toBe(3000);
      expect(result.filePaths).toHaveLength(2);

      teardownTestDist();
    });

    it("throws on missing file", () => {
      setupTestDist();
      expect(() => measureBundleSize(testDir, ["missing.js"])).toThrow("Missing dist file");
      teardownTestDist();
    });
  });

  describe("checkBudget", () => {
    it("passes when size is within budget and no forbidden imports", () => {
      setupTestDist();
      writeFileSync(join(testDir, "index.js"), "a".repeat(1000));
      writeFileSync(join(testDir, "index.cjs"), "b".repeat(1000));

      const budget: BundleBudget = {
        maxSize: 3000,
        forbiddenDeps: ["@stellar/stellar-sdk"],
        description: "Test entry",
      };

      const result = checkBudget("./test", testDir, ["index.js", "index.cjs"], budget);

      expect(result.passed).toBe(true);
      expect(result.withinBudget).toBe(true);
      expect(result.forbiddenImportsFound).toEqual([]);
      expect(result.actualSize).toBe(2000);

      teardownTestDist();
    });

    it("fails when size exceeds budget", () => {
      setupTestDist();
      writeFileSync(join(testDir, "big.js"), "x".repeat(5000));

      const budget: BundleBudget = {
        maxSize: 1000,
        description: "Small budget",
      };

      const result = checkBudget("./test", testDir, ["big.js"], budget);

      expect(result.passed).toBe(false);
      expect(result.withinBudget).toBe(false);
      expect(result.actualSize).toBe(5000);

      teardownTestDist();
    });

    it("fails when forbidden imports are found", () => {
      setupTestDist();
      writeFileSync(join(testDir, "bad.js"), 'import x from "@stellar/stellar-sdk";');

      const budget: BundleBudget = {
        maxSize: 100000,
        forbiddenDeps: ["@stellar/stellar-sdk"],
        description: "No stellar-sdk allowed",
      };

      const result = checkBudget("./test", testDir, ["bad.js"], budget);

      expect(result.passed).toBe(false);
      expect(result.withinBudget).toBe(true);
      expect(result.forbiddenImportsFound).toContain("@stellar/stellar-sdk");

      teardownTestDist();
    });
  });

  describe("formatSize", () => {
    it("formats bytes correctly", () => {
      expect(formatSize(512)).toBe("512B");
      expect(formatSize(1024)).toBe("1.00KB");
      expect(formatSize(1536)).toBe("1.50KB");
      expect(formatSize(1024 * 1024)).toBe("1.00MB");
      expect(formatSize(1.5 * 1024 * 1024)).toBe("1.50MB");
    });
  });
});
