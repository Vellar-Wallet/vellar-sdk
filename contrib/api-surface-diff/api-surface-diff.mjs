#!/usr/bin/env node
// REFERENCE IMPLEMENTATION for issue #686.
// Copy/adapt into scripts/api-surface-diff.mjs, see this folder's README.md
// for exact integration and release-process wiring steps.
//
// Extracts the public export surface (named exports only — this is
// deliberately NOT a full structural type diff, see README) from a .d.ts
// file, and diffs two surfaces (previously published vs. current working
// tree) into added / removed / changed buckets.
//
// Usage:
//   node scripts/api-surface-diff.mjs <previous.d.ts> <current.d.ts>
//   node scripts/api-surface-diff.mjs --from-npm <package-name> <current.d.ts>

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Extracts named exports from a .d.ts file's text.
 *
 * Handles the forms actually seen in this repo's bundled dist output:
 *   export { a as Foo, b as Bar } from './chunk.js';
 *   export { Foo, Bar } from './chunk.js';
 *   export declare function foo(...): ...;
 *   export declare const foo: ...;
 *   export declare class Foo { ... }
 *   export interface Foo { ... }
 *   export type Foo = ...;
 *
 * Returns a map of exported name -> a short "signature" string used to
 * detect a changed export (not a full structural diff — see README for why).
 */
export function extractExportSurface(dtsSource) {
  const surface = new Map();

  // export { a as Foo, b as Bar, Baz } from '...';
  const reExportBlockRe = /export\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]\s*;/g;
  let match;
  while ((match = reExportBlockRe.exec(dtsSource)) !== null) {
    const names = match[1].split(",").map((s) => s.trim()).filter(Boolean);
    for (const entry of names) {
      const asMatch = entry.match(/^(\S+)\s+as\s+(\S+)$/);
      const exportedName = asMatch ? asMatch[2] : entry;
      if (!surface.has(exportedName)) {
        surface.set(exportedName, "re-export");
      }
    }
  }

  // export declare function foo(...);
  const fnRe = /export\s+declare\s+function\s+(\w+)\s*(\([^)]*\))/g;
  while ((match = fnRe.exec(dtsSource)) !== null) {
    surface.set(match[1], `function${match[2] ?? ""}`);
  }

  // export declare const foo: Type;
  const constRe = /export\s+declare\s+const\s+(\w+)\s*:\s*([^;=\n]+)/g;
  while ((match = constRe.exec(dtsSource)) !== null) {
    surface.set(match[1], `const: ${match[2].trim()}`);
  }

  // export declare class Foo
  const classRe = /export\s+declare\s+class\s+(\w+)/g;
  while ((match = classRe.exec(dtsSource)) !== null) {
    surface.set(match[1], "class");
  }

  // export interface Foo
  const interfaceRe = /export\s+interface\s+(\w+)/g;
  while ((match = interfaceRe.exec(dtsSource)) !== null) {
    surface.set(match[1], "interface");
  }

  // export type Foo =
  const typeRe = /export\s+type\s+(\w+)\s*=/g;
  while ((match = typeRe.exec(dtsSource)) !== null) {
    surface.set(match[1], "type");
  }

  return surface;
}

/**
 * @typedef {{ name: string, before?: string, after?: string }} ExportDiffEntry
 * @typedef {{ added: ExportDiffEntry[], removed: ExportDiffEntry[], changed: ExportDiffEntry[], unchanged: string[] }} ExportDiffResult
 */

/**
 * Diffs two export-surface maps (as returned by extractExportSurface).
 * @returns {ExportDiffResult}
 */
export function diffExportSurfaces(before, after) {
  const added = [];
  const removed = [];
  const changed = [];
  const unchanged = [];

  for (const [name, afterSig] of after) {
    if (!before.has(name)) {
      added.push({ name, after: afterSig });
      continue;
    }
    const beforeSig = before.get(name);
    if (beforeSig === "re-export" || afterSig === "re-export") {
      // Re-exports only carry presence/absence, never a comparable
      // signature (the bundled chunk hides the real declaration), so a
      // re-export is only ever "present" or "removed", never "changed".
      unchanged.push(name);
      continue;
    }
    if (beforeSig !== afterSig) {
      changed.push({ name, before: beforeSig, after: afterSig });
    } else {
      unchanged.push(name);
    }
  }

  for (const [name, beforeSig] of before) {
    if (!after.has(name)) {
      removed.push({ name, before: beforeSig });
    }
  }

  return { added, removed, changed, unchanged };
}

function findIndexDts(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.name === "index.d.ts") {
      return path.join(entry.parentPath ?? dir, entry.name);
    }
  }
  return undefined;
}

function fetchPublishedDts(packageName) {
  const dir = mkdtempSync(path.join(tmpdir(), "api-surface-diff-"));
  execFileSync("npm", ["pack", packageName, "--pack-destination", dir], { stdio: "pipe" });
  const tgz = readdirSync(dir).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error(`npm pack did not produce a .tgz for ${packageName}`);
  execFileSync("tar", ["xzf", tgz], { cwd: dir, stdio: "pipe" });
  const dtsPath = findIndexDts(path.join(dir, "package"));
  if (!dtsPath) throw new Error(`Could not find index.d.ts in packed ${packageName}`);
  return readFileSync(dtsPath, "utf8");
}

function main() {
  const args = process.argv.slice(2);
  let beforeSource;
  let afterPath;

  if (args[0] === "--from-npm") {
    beforeSource = fetchPublishedDts(args[1]);
    afterPath = args[2];
  } else {
    beforeSource = readFileSync(args[0], "utf8");
    afterPath = args[1];
  }

  if (!afterPath) {
    console.error("Usage: api-surface-diff.mjs <previous.d.ts> <current.d.ts>");
    console.error("   or: api-surface-diff.mjs --from-npm <package-name> <current.d.ts>");
    process.exit(2);
  }

  const afterSource = readFileSync(afterPath, "utf8");
  const before = extractExportSurface(beforeSource);
  const after = extractExportSurface(afterSource);
  const diff = diffExportSurfaces(before, after);

  console.log(`Public export surface diff: ${diff.unchanged.length} unchanged, ${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed.\n`);

  for (const entry of diff.added) console.log(`  + ${entry.name} (${entry.after})`);
  for (const entry of diff.changed) console.log(`  ~ ${entry.name}: ${entry.before} -> ${entry.after}`);
  for (const entry of diff.removed) console.log(`  - ${entry.name} (was ${entry.before})`);

  if (diff.removed.length > 0 || diff.changed.length > 0) {
    console.error("\nThis diff includes a removed or changed export. Confirm it is documented in CHANGELOG.md as a breaking change before publishing.");
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
