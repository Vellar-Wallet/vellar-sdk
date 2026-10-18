#!/usr/bin/env node
/**
 * REFERENCE IMPLEMENTATION: Check that every contrib example builds and typechecks.
 *
 * This is a template/reference showing the intended implementation pattern for issue #631.
 * It serves as documentation of the expected behavior and can be used for testing the concept
 * before integrating into scripts/ and CI.
 *
 * To use this reference:
 * 1. Copy the implementation pattern to scripts/check-contrib-examples.mjs
 * 2. Add unit tests in scripts/check-contrib-examples.test.ts
 * 3. Add the check-contrib-examples job to .github/workflows/ci.yml
 * 4. Update contrib/README.md with local run instructions
 *
 * See check-contrib-examples-recipe.md for detailed implementation guidance.
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
 * Returns an array of { path, name, hasPackageJson, hasTsConfig }
 */
function findExamplesToCheck() {
  const results = [];

  // 1. Check contrib root for directories with package.json or tsconfig.json
  try {
    const contribEntries = readdirSync(contribDir);
    for (const entry of contribEntries) {
      const fullPath = path.join(contribDir, entry);
      try {
        if (!statSync(fullPath).isDirectory()) continue;
      } catch {
        continue; // Skip if stat fails
      }

      const hasPackageJson = existsSync(path.join(fullPath, "package.json"));
      const hasTsConfig = existsSync(path.join(fullPath, "tsconfig.json"));

      if (hasPackageJson || hasTsConfig) {
        results.push({
          path: fullPath,
          name: entry,
          hasPackageJson,
          hasTsConfig,
        });
      }
    }
  } catch (error) {
    console.warn(`⚠️  Warning: Could not read contrib directory: ${error.message}`);
  }

  // 2. Check contrib/examples/* for directories with package.json or tsconfig.json
  if (existsSync(examplesDir)) {
    try {
      const exampleEntries = readdirSync(examplesDir);
      for (const entry of exampleEntries) {
        const fullPath = path.join(examplesDir, entry);
        try {
          if (!statSync(fullPath).isDirectory()) continue;
        } catch {
          continue;
        }

        const hasPackageJson = existsSync(path.join(fullPath, "package.json"));
        const hasTsConfig = existsSync(path.join(fullPath, "tsconfig.json"));

        if (hasPackageJson || hasTsConfig) {
          results.push({
            path: fullPath,
            name: `examples/${entry}`,
            hasPackageJson,
            hasTsConfig,
          });
        }
      }
    } catch (error) {
      console.warn(`⚠️  Warning: Could not read examples directory: ${error.message}`);
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
  } catch (error) {
    console.warn(`⚠️  Warning: Could not parse package.json at ${packageJsonPath}: ${error.message}`);
    return {};
  }
}

/**
 * Run typecheck for an example.
 * Uses the example's tsconfig.json if available, otherwise falls back to root.
 */
function runTypecheck(example) {
  const { path: examplePath } = example;

  try {
    if (example.hasTsConfig) {
      execFileSync("npx", ["tsc", "--noEmit", "-p", examplePath], {
        cwd: root,
        stdio: "inherit",
      });
    } else {
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
  const { path: examplePath } = example;

  const scripts = getPackageScripts(examplePath);
  if (!scripts.build) {
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
    return 0; // Not a failure
  }

  console.log(`ℹ️  Found ${examples.length} example(s) to check`);
  console.log("");

  let failedExample = null;
  let failedStep = null;

  for (const example of examples) {
    const { name, hasPackageJson } = example;

    console.log(`🔍 Checking ${name}...`);

    // Step 1: Typecheck
    console.log(`   • Typecheck...`);
    const typecheckResult = runTypecheck(example);
    if (!typecheckResult.success) {
      failedExample = name;
      failedStep = "typecheck";
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
