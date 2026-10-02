// Reference implementation for #445: Bundle size budget check
// This demonstrates automated bundle-size validation per entry point with
// structural invariant checks (forbidden imports).

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface BundleBudget {
  maxSize: number; // in bytes
  forbiddenDeps?: string[];
  description: string;
}

export interface BudgetCheckResult {
  entryPoint: string;
  actualSize: number;
  budgetSize: number;
  withinBudget: boolean;
  forbiddenImportsFound: string[];
  passed: boolean;
}

/**
 * Check if a built file imports any forbidden dependencies.
 * Scans for import/require patterns matching the forbidden dep names.
 */
export function checkForbiddenImports(
  filePath: string,
  forbiddenDeps: string[],
): string[] {
  const content = readFileSync(filePath, "utf8");
  const violations: string[] = [];

  for (const dep of forbiddenDeps) {
    // Check various import patterns
    const patterns = [
      new RegExp(`from\\s+["']${dep.replace("/", "\\/")}`, "g"),
      new RegExp(`require\\(["']${dep.replace("/", "\\/")}`, "g"),
      new RegExp(`import\\(["']${dep.replace("/", "\\/")}`, "g"),
    ];

    if (patterns.some((p) => p.test(content))) {
      violations.push(dep);
    }
  }

  return violations;
}

/**
 * Measure the total size of built files for an entry point.
 * Sums ESM (.js) and CJS (.cjs) variants.
 */
export function measureBundleSize(
  distDir: string,
  files: string[],
): { totalSize: number; filePaths: string[] } {
  let totalSize = 0;
  const filePaths: string[] = [];

  for (const file of files) {
    const path = join(distDir, file);
    try {
      const stat = statSync(path);
      totalSize += stat.size;
      filePaths.push(path);
    } catch {
      throw new Error(`Missing dist file: ${file}`);
    }
  }

  return { totalSize, filePaths };
}

/**
 * Run budget check for a single entry point.
 */
export function checkBudget(
  entryPoint: string,
  distDir: string,
  files: string[],
  budget: BundleBudget,
): BudgetCheckResult {
  const { totalSize, filePaths } = measureBundleSize(distDir, files);
  const withinBudget = totalSize <= budget.maxSize;

  // Check forbidden imports
  const forbiddenImportsFound: string[] = [];
  if (budget.forbiddenDeps) {
    for (const filePath of filePaths) {
      const violations = checkForbiddenImports(filePath, budget.forbiddenDeps);
      forbiddenImportsFound.push(...violations);
    }
  }

  const passed = withinBudget && forbiddenImportsFound.length === 0;

  return {
    entryPoint,
    actualSize: totalSize,
    budgetSize: budget.maxSize,
    withinBudget,
    forbiddenImportsFound: [...new Set(forbiddenImportsFound)],
    passed,
  };
}

/**
 * Format bytes to human-readable string.
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

/**
 * Example budget configuration matching the SDK's 6 entry points.
 */
export const DEFAULT_BUDGETS: Record<string, BundleBudget> = {
  ".": {
    maxSize: 150 * 1024, // 150KB
    forbiddenDeps: ["@stellar/stellar-sdk"],
    description: "Root entry must not pull in stellar-sdk",
  },
  "./balances": {
    maxSize: 500 * 1024, // 500KB
    description: "Balances entry includes stellar-sdk for RPC",
  },
  "./rpc": {
    maxSize: 450 * 1024, // 450KB
    description: "RPC utilities with stellar-sdk",
  },
  "./x402": {
    maxSize: 120 * 1024, // 120KB
    forbiddenDeps: ["@stellar/stellar-sdk"],
    description: "x402 client without stellar-sdk",
  },
  "./x402-guards": {
    maxSize: 50 * 1024, // 50KB
    forbiddenDeps: ["@stellar/stellar-sdk", "vellar-sdk"],
    description: "Pure decision layer - no wallet plumbing",
  },
  "./policies": {
    maxSize: 80 * 1024, // 80KB
    forbiddenDeps: ["@stellar/stellar-sdk"],
    description: "Policy types and utilities",
  },
};

/**
 * Entry point to file mappings.
 */
export const ENTRY_FILES: Record<string, string[]> = {
  ".": ["index.js", "index.cjs"],
  "./balances": ["balances.js", "balances.cjs"],
  "./rpc": ["rpc.js", "rpc.cjs"],
  "./x402": ["x402.js", "x402.cjs"],
  "./x402-guards": ["x402-guards.js", "x402-guards.cjs"],
  "./policies": ["policies.js", "policies.cjs"],
};
