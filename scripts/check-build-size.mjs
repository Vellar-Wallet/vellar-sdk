#!/usr/bin/env node
// Measure the built dist/ output sizes for the root package (vellar-sdk),
// packages/cli (vellar-cli), and packages/mcp-x402-payer (vellar-mcp-x402-payer)
// and fail if any package exceeds its configured budget in
// scripts/build-size-budgets.json (issue #684).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const budgetsPath = path.join(root, "scripts", "build-size-budgets.json");
const args = new Set(process.argv.slice(2));
const jsonOutput = args.has("--json");

function formatBytes(bytes) {
  return `${bytes} B (${(bytes / 1024).toFixed(2)} KiB)`;
}

function classifyDistFile(fileName) {
  if (fileName.endsWith(".map")) return "sourcemap";
  if (
    fileName.endsWith(".d.ts") ||
    fileName.endsWith(".d.cts") ||
    fileName.endsWith(".d.mts")
  )
    return "types";
  if (
    fileName.endsWith(".js") ||
    fileName.endsWith(".cjs") ||
    fileName.endsWith(".mjs")
  )
    return "runtime";
  return "other";
}

function collectFilesRecursive(dir, baseDir = dir) {
  const entries = [];
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      entries.push(...collectFilesRecursive(fullPath, baseDir));
    } else if (dirent.isFile()) {
      const stat = fs.statSync(fullPath);
      entries.push({
        relativePath: path.relative(baseDir, fullPath).replace(/\\/g, "/"),
        bytes: stat.size,
        category: classifyDistFile(dirent.name),
      });
    }
  }
  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

const { budgets } = JSON.parse(fs.readFileSync(budgetsPath, "utf8"));
const results = [];
const allErrors = [];

for (const budget of budgets) {
  const distPath = path.resolve(
    root,
    budget.packageDir,
    budget.distDir ?? "dist"
  );
  const exists = fs.existsSync(distPath);
  const files = exists ? collectFilesRecursive(distPath) : [];
  let runtimeBytes = 0;
  let largestRuntimeFile = null;

  for (const f of files) {
    if (f.category === "runtime") {
      runtimeBytes += f.bytes;
      if (!largestRuntimeFile || f.bytes > largestRuntimeFile.bytes) {
        largestRuntimeFile = f;
      }
    }
  }

  const errors = [];
  let exceededTotalByBytes = 0;
  let exceededSingleFileByBytes = 0;

  if (!exists || files.length === 0) {
    errors.push(
      `Package "${budget.packageName}" (${budget.packageDir}/${budget.distDir ?? "dist"}) has no build output. Run \`npm run build\` across workspaces first.`
    );
  } else {
    if (runtimeBytes > budget.maxTotalBytes) {
      exceededTotalByBytes = runtimeBytes - budget.maxTotalBytes;
      errors.push(
        `Package "${budget.packageName}" exceeded its total dist runtime budget by ${formatBytes(exceededTotalByBytes)} ` +
          `(measured ${formatBytes(runtimeBytes)} vs budget ${formatBytes(budget.maxTotalBytes)}). ` +
          `See docs/build-size-budgets.md for how to investigate or deliberately raise the budget.`
      );
    }
    if (
      largestRuntimeFile &&
      largestRuntimeFile.bytes > budget.maxSingleFileBytes
    ) {
      exceededSingleFileByBytes =
        largestRuntimeFile.bytes - budget.maxSingleFileBytes;
      errors.push(
        `Package "${budget.packageName}" chunk "${largestRuntimeFile.relativePath}" exceeded maxSingleFileBytes by ${formatBytes(exceededSingleFileByBytes)} ` +
          `(measured ${formatBytes(largestRuntimeFile.bytes)} vs budget ${formatBytes(budget.maxSingleFileBytes)}).`
      );
    }
  }

  allErrors.push(...errors);
  results.push({
    packageName: budget.packageName,
    packageDir: budget.packageDir,
    runtimeBytes,
    maxTotalBytes: budget.maxTotalBytes,
    largestRuntimeFile,
    maxSingleFileBytes: budget.maxSingleFileBytes,
    passed: errors.length === 0,
    exceededTotalByBytes,
    exceededSingleFileByBytes,
    errors,
  });
}

const passed = allErrors.length === 0;

if (jsonOutput) {
  console.log(JSON.stringify({ passed, results, errors: allErrors }, null, 2));
} else {
  console.log("Workspace Build Size Budget Report:");
  for (const r of results) {
    const status = r.passed ? "PASS" : "FAIL";
    const pct = ((r.runtimeBytes / r.maxTotalBytes) * 100).toFixed(1);
    console.log(
      `  [${status}] ${r.packageName} (${r.packageDir}): ${formatBytes(r.runtimeBytes)} / ${formatBytes(r.maxTotalBytes)} (${pct}% of budget)`
    );
  }
  if (!passed) {
    console.error("\nBuild size budget failures:");
    for (const err of allErrors) {
      console.error(`  - ${err}`);
    }
  }
}

if (!passed) {
  process.exit(1);
}
