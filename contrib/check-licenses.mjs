#!/usr/bin/env node
// Fail when the dependency tree of the root package or either workspace
// package carries a license outside the Apache-2.0-compatible allowlist.
//
// The one known copyleft package is NOT skipped quietly: it is an explicit,
// dated exception for @openzeppelin/relayer-sdk (issue 516). A different
// package with the same license still fails.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** SPDX ids compatible with distributing this Apache-2.0 tree. */
export const ALLOWED_LICENSES = new Set([
  "Apache-2.0",
  "MIT",
  "MIT-0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "Unlicense",
  "CC0-1.0",
  "BlueOak-1.0.0",
  "BSL-1.0",
  "Zlib",
  "Python-2.0",
]);

/**
 * Packages whose license would otherwise fail, recorded on purpose.
 * `license: null` means the published metadata has no license field.
 * A later release that declares a different license does not match.
 */
export const LICENSE_EXCEPTIONS = [
  {
    name: "@openzeppelin/relayer-sdk",
    license: "AGPL-3.0-or-later",
    dated: "2026-09-30",
    issue: 516,
    reason:
      "Transitive dev/optional dependency via passkey-kit. Decision recorded in contrib/license-decision.md. This is not a blanket AGPL allow.",
  },
  {
    name: "passkey-kit-sdk",
    license: null,
    dated: "2026-10-20",
    reason:
      "The published package.json and the lockfile omit `license`. Upstream kalepail/passkey-kit LICENCE is MIT. Recorded so a missing field is not skipped silently.",
  },
  {
    name: "sac-sdk",
    license: null,
    dated: "2026-10-20",
    reason:
      "The published package.json and the lockfile omit `license`. Upstream kalepail/passkey-kit LICENCE is MIT. Recorded so a missing field is not skipped silently.",
  },
];

const ROOTS = ["", "packages/cli", "packages/mcp-x402-payer"];

export function packageName(key, entry) {
  if (key === "") return entry?.name ?? "vellar-sdk";
  if (key.startsWith("packages/") && entry?.name) return entry.name;
  const marker = "node_modules/";
  const at = key.lastIndexOf(marker);
  if (at === -1) return entry?.name ?? key;
  return key.slice(at + marker.length);
}

export function declaredLicense(entry) {
  if (!entry) return null;
  if (typeof entry.license === "string" && entry.license.trim() !== "") return entry.license.trim();
  if (entry.license && typeof entry.license === "object" && typeof entry.license.type === "string") {
    return entry.license.type.trim();
  }
  if (Array.isArray(entry.licenses) && entry.licenses.length > 0) {
    const first = entry.licenses[0];
    if (typeof first === "string") return first;
    if (first && typeof first.type === "string") return first.type;
  }
  return null;
}

function splitTop(expr, op) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0 && expr.startsWith(op, i)) {
      parts.push(expr.slice(start, i).trim());
      i += op.length - 1;
      start = i + 1;
    }
  }
  parts.push(expr.slice(start).trim());
  return parts.filter((p) => p.length > 0);
}

/** True when every conjunct (and at least one disjunct) is on the allowlist. */
export function licenseAllowed(license) {
  const expr = license.trim();
  if (expr.startsWith("(") && expr.endsWith(")")) return licenseAllowed(expr.slice(1, -1));
  const orParts = splitTop(expr, " OR ");
  if (orParts.length > 1) return orParts.some(licenseAllowed);
  const andParts = splitTop(expr, " AND ");
  if (andParts.length > 1) return andParts.every(licenseAllowed);
  const withAt = expr.indexOf(" WITH ");
  if (withAt !== -1) return licenseAllowed(expr.slice(0, withAt));
  return ALLOWED_LICENSES.has(expr);
}

export function matchingException(name, license) {
  return LICENSE_EXCEPTIONS.find((e) => e.name === name && e.license === license) ?? null;
}

function resolveDep(packages, parentKey, name) {
  let scope = parentKey;
  for (;;) {
    const candidate = scope ? `${scope}/node_modules/${name}` : `node_modules/${name}`;
    if (Object.prototype.hasOwnProperty.call(packages, candidate)) return candidate;
    if (!scope) return null;
    const idx = scope.lastIndexOf("/node_modules/");
    scope = idx === -1 ? "" : scope.slice(0, idx);
  }
}

function installedDeps(key, entry) {
  const deps = { ...(entry.dependencies ?? {}), ...(entry.optionalDependencies ?? {}) };
  // Dev dependencies are installed for the roots we ship from, not for
  // transitive packages (npm does not install those).
  if (ROOTS.includes(key)) Object.assign(deps, entry.devDependencies ?? {});
  return deps;
}

function followLink(packages, key, entry) {
  if (!entry?.link) return key;
  const target = entry.resolved ?? "";
  if (Object.prototype.hasOwnProperty.call(packages, target)) return target;
  return key;
}

/**
 * Packages reachable from the root and both workspace packages, including
 * dev dependencies of those three roots.
 */
export function collectTree(packages) {
  const seen = new Set();
  const queue = [...ROOTS];
  const missing = [];

  while (queue.length > 0) {
    const raw = queue.shift();
    const entry = packages[raw];
    if (!entry) {
      missing.push(raw);
      continue;
    }
    const key = followLink(packages, raw, entry);
    if (seen.has(key)) continue;
    seen.add(key);
    const node = packages[key];
    if (!node) {
      missing.push(key);
      continue;
    }
    for (const name of Object.keys(installedDeps(key, node))) {
      const resolved = resolveDep(packages, key, name);
      if (!resolved) missing.push(`${key || "<root>"} -> ${name}`);
      else queue.push(resolved);
    }
  }

  return { keys: [...seen], missing };
}

export function auditLockfile(lock) {
  const packages = lock.packages ?? {};
  const { keys, missing } = collectTree(packages);
  const violations = missing.map((ref) => ({
    name: ref,
    license: null,
    reason: "dependency could not be resolved in the lockfile",
  }));

  for (const key of keys) {
    const entry = packages[key];
    if (entry?.link) continue;
    const name = packageName(key, entry);
    const license = declaredLicense(entry);
    if (matchingException(name, license)) continue;
    if (license && licenseAllowed(license)) continue;
    violations.push({
      name,
      license,
      reason: license
        ? `license ${license} is outside the Apache-2.0 allowlist`
        : "no license declared",
    });
  }

  return { ok: violations.length === 0, violations };
}

function report(result) {
  if (result.ok) {
    console.log("license audit passed (root + packages/cli + packages/mcp-x402-payer)");
    return;
  }
  console.error("license audit failed:");
  for (const v of result.violations) {
    console.error(`  - ${v.name}: ${v.reason}`);
  }
  console.error(
    "\nAdd a compatible license to the allowlist, or an explicit dated exception. Do not ignore a license silently.",
  );
}

function main() {
  const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const result = auditLockfile(lock);
  report(result);
  if (!result.ok) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
