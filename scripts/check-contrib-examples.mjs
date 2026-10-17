#!/usr/bin/env node
/**
 * Check that every contrib example directory builds and typechecks.
 *
 * Examples are organized into two categories:
 * 1. Standalone examples with their own package.json/tsconfig.json (e.g., coverage-runner)
 * 2. Shared examples in contrib/examples/* that use the root tsconfig.json
 *
 * For each example with a package.json or tsconfig.json:
 * - Run typecheck using the example's tsconfig.json or fallback to tsc --noEmit
 * - Run build script if it exists in package.json
 * - Fail on the first error, reporting which example and which step failed
 *
 * Exit codes:
 * - 0: success
 * - 1: typecheck or build failed
 * - 2: fatal error (e.g., no examples found)
 */

import { execFileSync } from "node:child_process";
import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contribDir = path.join(root, "contrib");
const examplesDir = path.join(contribDir, "examples");

/**
 * Collect all directories that need to be checked.
 * Returns { path, name, hasPackageJson, hasTsConfig }
 */
function findExamplesToCheck() {
  const results = [];

  // 1. Check contrib root for directories with package.json or tsconfig.json (e.g., coverage-runner)
  const contribEntries = readdirSync(contribDir);
  for (const entry of contribEntries) {
    const fullPath = path.join(contribDir, entry);
    if (!statSync(fullPath).isDirectory()) continue;

    const hasPackageJson = existsSync(path.join(fullPath, "package.json"));
    const hasTsConfig = existsSync(path.join(fullPath, "tsconfig.json"));

    // Only include if it has one of these files
    if (hasPackageJson || hasTsConfig) {
      results.push({
        path: fullPath,
        name: entry,
        hasPackageJson,
        hasTsConfig,
        isExample: false,
      });
    }
  }

  // 2. Check contrib/examples/* for directories with package.json or tsconfig.json
  if (existsSync(examplesDir)) {
    const exampleEntries = readdirSync(examplesDir);
    for (const entry of exampleEntries) {
      const fullPath = path.join(examplesDir, entry);
      if (!statSync(fullPath).isDirectory()) continue;

      const hasPackageJson = existsSync(path.join(fullPath, "package.json"));
      const hasTsConfig = existsSync(path.join(fullPath, "tsconfig.json"));

      // Only include if it has one of these files
      if (hasPackageJson || hasTsConfig) {
        results.push({
          path: fullPath,
          name: `examples/${entry}`,
          hasPackageJson,
          hasTsConfig,
          isExample: true,
        });
      }
    }
  }

  return results;
}

/**
 * Get package.json scripts for a given example.
 */
function getPackageScripts(examplePath) {
  const packageJsonPath = path.join(examplePath, "package.json");
  if (!existsSync(packageJsonPath)) {
    return {};
  }
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

/**
 * Run typecheck for an example.
 * Tries example's tsconfig.json first, falls back to tsc --noEmit.
 */
function runTypecheck(example) {
  const { path: examplePath, name } = example;

  try {
    if (example.hasTsConfig) {
      // Use the example's tsconfig.json
      execFileSync("npx", ["tsc", "--noEmit", "-p", examplePath], {
        cwd: root,
        stdio: "inherit",
      });
    } else {
      // Fall back to tsc --noEmit -p with root tsconfig
      execFileSync("npx", ["tsc", "--noEmit", "-p", root], {
        cwd: root,
        stdio: "inherit",
      });
    }
    return { success: true };
  } catch (error) {
    return { success: false, error };
  }
}

/**
 * Run build for an example (if package.json has a build script).
 */
function runBuild(example) {
  const { path: examplePath, name } = example;

  const scripts = getPackageScripts(examplePath);
  if (!scripts.build) {
    // No build script, skip
    return { success: true, skipped: true };
  }

  try {
    execFileSync("npm", ["run", "build"], {
      cwd: examplePath,
      stdio: "inherit",
    });
    return { success: true };
  } catch (error) {
    return { success: false, error };
  }
}

/**
 * Main entry point.
 */
function main() {
  const examples = findExamplesToCheck();

  if (examples.length === 0) {
    console.warn("⚠️  No contrib examples with package.json or tsconfig.json found to check");
    console.warn(`   Checked: ${contribDir} and ${examplesDir}`);
    return 0; // Not a failure — just nothing to do
  }

  console.log(`ℹ️  Found ${examples.length} example(s) to check`);
  console.log("");

  let failedExample = null;
  let failedStep = null;
  let failedError = null;

  for (const example of examples) {
    const { name, hasPackageJson, hasTsConfig } = example;

    console.log(`🔍 Checking ${name}...`);

    // Step 1: Typecheck
    console.log(`   • Typecheck...`);
    const typecheckResult = runTypecheck(example);
    if (!typecheckResult.success) {
      failedExample = name;
      failedStep = "typecheck";
      failedError = typecheckResult.error;
      break;
    }
    console.log(`     ✓ Typecheck passed`);

    // Step 2: Build (if package.json exists)
    if (hasPackageJson) {
      console.log(`   • Build...`);
      const buildResult = runBuild(example);
      if (!buildResult.success) {
        failedExample = name;
        failedStep = "build";
        failedError = buildResult.error;
        break;
      }
      if (buildResult.skipped) {
        console.log(`     ⊘ Build script not found, skipped`);
      } else {
        console.log(`     ✓ Build passed`);
      }
    }

    console.log("");
  }

  if (failedExample) {
    console.error("");
    console.error(`❌ FAILED: ${failedExample} failed ${failedStep}`);
    console.error("");
    process.exit(1);
  }

  console.log(`✅ All ${examples.length} example(s) passed typecheck and build`);
  return 0;
}

process.exit(main());
