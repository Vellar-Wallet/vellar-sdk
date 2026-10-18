#!/usr/bin/env node
// Verify that every workspace package pins @x402/core and @x402/stellar to
// mutually compatible major versions.
//
// WHY THIS EXISTS. The root workspaces and sub-packages each declare their own
// @x402/* dependencies. If one package bumps its pin and the others are left
// behind, runtime behaviour diverges silently: the packages share the same
// major-version protocol contract, so a minor-version mismatch is unlikely to
// blow up immediately — it surfaces as a subtle encoding or validation drift
// that only shows up under live traffic.
//
// This script is the canary. It reads every package.json in the workspace,
// collects the declared specifiers for @x402/core and @x402/stellar, resolves
// each specifier to a major version (stripping semver range operators), then
// fails if any two resolved majors disagree.
//
// Usage (CLI):
//   node contrib/x402-version-check/check-x402-versions.mjs
//   node contrib/x402-version-check/check-x402-versions.mjs --root <dir>
//
// Exit 0 only when all declared versions are major-compatible.
//
// Library usage (unit tests import from here):
//   import { checkX402Versions, resolveMajor, ... } from "./check-x402-versions.mjs";

import { readFileSync, readdirSync, statSync } from "node:fs";
import path, { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

export const X402_PACKAGES = ["@x402/core", "@x402/stellar"];

/**
 * Strip semver range operators (^, ~, >=, >, <=, <, =) and any leading `v`
 * from a version specifier, then extract the major version number.
 *
 * Returns `null` for workspace://, file://, URL, or other non-semver specifiers.
 *
 * @param {string} specifier
 * @returns {number | null}
 */
export function resolveMajor(specifier) {
  if (!specifier || typeof specifier !== "string") return null;

  // Skip workspace/file/URL specifiers — they are not version strings.
  if (/^(workspace|file|https?):/.test(specifier)) return null;

  // Strip leading range operators and optional `v` prefix, then grab the
  // first version segment from the (possibly space-separated) range.
  //
  // Examples:
  //   "2.22.0"   → 2
  //   "^2.16.0"  → 2
  //   "~3.1.0"   → 3
  //   ">=2.0.0"  → 2
  //   "2.x"      → 2
  //   "*"        → null  (wildcard, cannot determine major)
  const stripped = specifier.replace(/^[~^>=<v]+/, "").split(/\s/)[0];
  if (!stripped || stripped === "*") return null;

  const major = parseInt(stripped.split(".")[0], 10);
  return Number.isFinite(major) && major >= 0 ? major : null;
}

/**
 * Read and JSON-parse a package.json file. Returns null if the file cannot be
 * read or parsed, so the caller can emit a human-readable error instead of
 * an unhandled exception.
 *
 * @param {string} filePath
 * @returns {object | null}
 */
export function readPackageJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Collect every declared specifier for the x402 packages from all deps fields.
 * `dependencies` takes priority over `devDependencies` over `peerDependencies`
 * when the same package appears in multiple fields.
 *
 * @param {object} pkg
 * @returns {Map<string, string>}  package-name → raw specifier
 */
export function collectX402Specifiers(pkg) {
  const found = new Map();
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const deps = pkg[field] ?? {};
    for (const name of X402_PACKAGES) {
      if (deps[name] !== undefined && !found.has(name)) {
        found.set(name, deps[name]);
      }
    }
  }
  return found;
}

/**
 * Discover every workspace directory listed in a root package.json's
 * `workspaces` field. Supports glob patterns of the form `<dir>/*` and
 * literal sub-directory paths (e.g. `packages/cli`).
 *
 * Returns an array of absolute paths to package directories.
 *
 * @param {string} rootDir
 * @param {string[]} workspacePatterns
 * @returns {string[]}
 */
export function resolveWorkspaceDirs(rootDir, workspacePatterns) {
  const dirs = [];
  for (const pattern of workspacePatterns) {
    if (pattern.endsWith("/*")) {
      const parentDir = join(rootDir, pattern.slice(0, -2));
      try {
        const entries = readdirSync(parentDir);
        for (const entry of entries) {
          const full = join(parentDir, entry);
          try {
            if (statSync(full).isDirectory()) dirs.push(full);
          } catch {
            /* skip unreadable entries */
          }
        }
      } catch {
        /* parent dir not found — skip */
      }
    } else {
      dirs.push(join(rootDir, pattern));
    }
  }
  return dirs;
}

/**
 * Scan the workspace rooted at `rootDir` and return a report of x402 version
 * alignment.
 *
 * @param {string} rootDir   absolute path to the monorepo root
 * @returns {{
 *   ok: boolean;
 *   entries: Array<{ location: string; package: string; specifier: string; major: number | null }>;
 *   conflicts: Array<{ package: string; majors: Map<number, string[]> }>;
 * }}
 */
export function checkX402Versions(rootDir) {
  const rootPkgPath = join(rootDir, "package.json");
  const rootPkg = readPackageJson(rootPkgPath);
  if (!rootPkg) {
    throw new Error(`Cannot read root package.json at ${rootPkgPath}`);
  }

  // Collect all package.json files: root + every workspace member.
  const pkgFiles = [{ location: "(root)", pkg: rootPkg }];

  const workspacePatterns = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : [];
  const workspaceDirs = resolveWorkspaceDirs(rootDir, workspacePatterns);
  for (const dir of workspaceDirs) {
    const pkgPath = join(dir, "package.json");
    const pkg = readPackageJson(pkgPath);
    if (pkg) {
      const label = pkg.name ?? dir.replace(rootDir, "").replace(/\\/g, "/");
      pkgFiles.push({ location: label, pkg });
    }
  }

  // Build a flat list of every x402 specifier found across all packages.
  /** @type {Array<{ location: string; package: string; specifier: string; major: number | null }>} */
  const entries = [];
  for (const { location, pkg } of pkgFiles) {
    const specifiers = collectX402Specifiers(pkg);
    for (const [name, specifier] of specifiers) {
      entries.push({ location, package: name, specifier, major: resolveMajor(specifier) });
    }
  }

  // Group by package name and check for major-version disagreements.
  /** @type {Array<{ package: string; majors: Map<number, string[]> }>} */
  const conflicts = [];
  for (const pkgName of X402_PACKAGES) {
    const relevant = entries.filter((e) => e.package === pkgName && e.major !== null);
    if (relevant.length < 2) continue;

    /** @type {Map<number, string[]>} */
    const byMajor = new Map();
    for (const e of relevant) {
      const list = byMajor.get(e.major) ?? [];
      list.push(`${e.location} (${e.specifier})`);
      byMajor.set(e.major, list);
    }
    if (byMajor.size > 1) {
      conflicts.push({ package: pkgName, majors: byMajor });
    }
  }

  return { ok: conflicts.length === 0, entries, conflicts };
}

// ── CLI entry point ──────────────────────────────────────────────────────────
// Guarded by isMain so the module is safely importable by unit tests without
// triggering process.exit.

const isMain = fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));

  // --root <dir> lets callers (and manual tests) point at a different tree.
  const rootArgIdx = process.argv.indexOf("--root");
  const rootDir =
    rootArgIdx !== -1 && process.argv[rootArgIdx + 1]
      ? resolve(process.argv[rootArgIdx + 1])
      : resolve(scriptDir, "../..");

  try {
    const { ok, entries, conflicts } = checkX402Versions(rootDir);

    if (entries.length === 0) {
      console.log("check:x402-versions  no x402 packages declared — nothing to check");
      process.exit(0);
    }

    // Print a summary table so a human can see exactly what was found.
    const byPkg = new Map();
    for (const e of entries) {
      const list = byPkg.get(e.package) ?? [];
      list.push(e);
      byPkg.set(e.package, list);
    }
    for (const [name, list] of byPkg) {
      for (const e of list) {
        console.log(`  ${name}  ${e.specifier.padEnd(12)}  ${e.location}`);
      }
    }

    if (ok) {
      console.log("\ncheck:x402-versions  all x402 packages are on compatible major versions ✓");
      process.exit(0);
    }

    console.error("\ncheck:x402-versions  FAIL — major-version mismatch detected:");
    for (const c of conflicts) {
      console.error(`  ${c.package}:`);
      for (const [major, locs] of c.majors) {
        console.error(`    major ${major}: ${locs.join(", ")}`);
      }
    }
    console.error(
      "\nFix: align all workspaces to the same major version of each @x402/* package, " +
        "then re-run the check.",
    );
    process.exit(1);
  } catch (err) {
    console.error(`check:x402-versions  error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
