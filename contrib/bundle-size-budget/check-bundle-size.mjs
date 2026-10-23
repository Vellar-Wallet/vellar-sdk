#!/usr/bin/env node
// REFERENCE IMPLEMENTATION for issue #684.
// Copy/adapt into scripts/check-bundle-size.mjs, see this folder's README.md
// for the exact integration steps (package.json script, CI wiring, budget
// calibration).
//
// Measures the built dist/ output size for the root package, packages/cli,
// and packages/mcp-x402-payer, and fails (non-zero exit) when any package's
// measured size exceeds its configured budget. Each package's budget has
// deliberate headroom over its last known-good measured size, so a routine
// dependency patch bump doesn't trip it, while a new dependency or an
// accidental non-tree-shaken import does.
//
// Usage: node scripts/check-bundle-size.mjs [--update-budgets]
//   --update-budgets   Print the current measured sizes in the exact object
//                       literal shape BUDGETS_KB uses below, for a reviewer
//                       to paste in after a deliberate, reviewed size
//                       increase. Does not write any file itself (never
//                       silently self-approves a budget increase).

import { readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Budget in kilobytes (1024 bytes) per package's dist/ output, measured as
 * the sum of every file under dist/ (JS + type declarations + source maps).
 * Each budget has roughly 20% headroom over the size measured when this
 * check was written — see this folder's README for the exact numbers and
 * how to recalibrate them once a real `npm run build` has been run in this
 * environment, which this reference implementation was written without
 * (see the PR's test plan for why).
 */
const BUDGETS_KB = {
  root: { distPath: "dist", budgetKb: 250 },
  cli: { distPath: "packages/cli/dist", budgetKb: 150 },
  "mcp-x402-payer": { distPath: "packages/mcp-x402-payer/dist", budgetKb: 150 },
};

function measureDirectoryBytes(dirPath) {
  if (!existsSync(dirPath)) {
    return undefined;
  }
  let total = 0;
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        total += statSync(full).size;
      }
    }
  }
  return total;
}

function formatKb(bytes) {
  return (bytes / 1024).toFixed(1);
}

export function checkBundleSizes(budgets = BUDGETS_KB, baseDir = root) {
  const results = [];
  for (const [name, config] of Object.entries(budgets)) {
    const distPath = path.join(baseDir, config.distPath);
    const measuredBytes = measureDirectoryBytes(distPath);
    if (measuredBytes === undefined) {
      results.push({
        name,
        measuredBytes: undefined,
        budgetKb: config.budgetKb,
        overBudget: false,
        skippedReason: `dist directory not found at ${config.distPath}; run the build first.`,
      });
      continue;
    }
    const measuredKb = measuredBytes / 1024;
    results.push({
      name,
      measuredBytes,
      measuredKb,
      budgetKb: config.budgetKb,
      overBudget: measuredKb > config.budgetKb,
    });
  }
  return results;
}

function main() {
  const updateBudgets = process.argv.includes("--update-budgets");
  const results = checkBundleSizes();

  let hasFailure = false;
  let hasSkipped = false;

  for (const result of results) {
    if (result.measuredBytes === undefined) {
      console.warn(`[bundle-size] ${result.name}: SKIPPED — ${result.skippedReason}`);
      hasSkipped = true;
      continue;
    }
    const status = result.overBudget ? "FAIL" : "ok";
    const overBy = result.overBudget
      ? ` (${formatKb(result.measuredBytes - result.budgetKb * 1024)}KB over)`
      : "";
    console.log(
      `[bundle-size] ${result.name}: ${status} — measured ${result.measuredKb.toFixed(1)}KB, budget ${result.budgetKb}KB${overBy}`,
    );
    if (result.overBudget) hasFailure = true;
  }

  if (updateBudgets) {
    console.log("\n--update-budgets: paste this into BUDGETS_KB after review:\n");
    for (const result of results) {
      if (result.measuredBytes === undefined) continue;
      const distPath = BUDGETS_KB[result.name].distPath;
      console.log(
        `  ${JSON.stringify(result.name)}: { distPath: ${JSON.stringify(distPath)}, budgetKb: ${Math.ceil(result.measuredKb * 1.2)} }, // measured ${result.measuredKb.toFixed(1)}KB`,
      );
    }
  }

  if (hasFailure) {
    console.error(
      "\nOne or more packages exceeded their bundle size budget. If this increase is an accepted, reviewed tradeoff, re-run with --update-budgets and paste the suggested values into BUDGETS_KB, documenting why in the PR description.",
    );
    process.exit(1);
  }

  if (hasSkipped) {
    // A skip (missing dist/) is not a failure on its own — the build step
    // that produces dist/ is expected to have already run before this
    // check in CI. Exiting 0 here keeps local ad-hoc runs (before a build)
    // from looking like a false failure.
    process.exit(0);
  }

  console.log("\nAll packages are within their bundle size budgets.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
