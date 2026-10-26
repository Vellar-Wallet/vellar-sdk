#!/usr/bin/env node
// Generates Subresource Integrity (SRI) hashes for every published dist file
// (#669), so a consumer loading vellar-sdk from a CDN (unpkg, jsdelivr) can
// pin an `integrity` attribute rather than trusting the CDN unverified.
//
// Run AFTER `npm run build`, as part of the release process
// (.github/workflows/publish.yml), hashing anything else would record the
// integrity of a stale or hand-edited build rather than what actually ships.
//
// Writes dist/sri-hashes.json (included in the published tarball via the
// existing `files: ["dist", ...]` entry in package.json, so a consumer can
// fetch it from the CDN itself and compare) and prints the same data to
// stdout for the release-notes step to capture.
//
// Usage: node scripts/generate-sri-hashes.mjs [--check]
//   --check: verify dist/sri-hashes.json matches the dist/ directory instead
//   of (re)writing it. Exits 1 on any mismatch, for CI to catch a hash that
//   fell out of sync with a rebuilt dist/ (e.g. a Step reordered in CI).

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_DIST_DIR = join(root, "dist");
const SRI_HASHES_FILENAME = "sri-hashes.json";

/** Recursively lists every regular file under `dir`, as paths relative to `dir`. */
function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listFiles(full).map((f) => join(entry, f)));
    } else if (stat.isFile()) {
      out.push(entry);
    }
  }
  return out;
}

/**
 * Computes a `sha384-<base64>` SRI hash for every regular file under
 * `distDir`, excluding sri-hashes.json itself (hashing the file that
 * records hashes would make every run change its own expected output).
 *
 * @param {string} [distDir] - Defaults to this repo's real dist/; a test
 *   passes a fixture directory instead, so this never needs an actual
 *   `npm run build` to exercise.
 */
export function computeSriHashes(distDir = DEFAULT_DIST_DIR) {
  const files = listFiles(distDir)
    .filter((f) => relative(distDir, join(distDir, f)) !== SRI_HASHES_FILENAME)
    .sort();

  const hashes = {};
  for (const file of files) {
    const bytes = readFileSync(join(distDir, file));
    const digest = createHash("sha384").update(bytes).digest("base64");
    hashes[file] = `sha384-${digest}`;
  }
  return hashes;
}

/**
 * Compares freshly computed hashes against what's recorded in
 * `<distDir>/sri-hashes.json`. Returns `{ ok: true }` on a match, or
 * `{ ok: false, reason }` describing the first mismatch found.
 */
export function checkSriHashes(distDir = DEFAULT_DIST_DIR) {
  const hashesFile = join(distDir, SRI_HASHES_FILENAME);
  let recorded;
  try {
    recorded = JSON.parse(readFileSync(hashesFile, "utf8"));
  } catch (err) {
    return { ok: false, reason: `could not read ${hashesFile}: ${err.message}` };
  }

  const computed = computeSriHashes(distDir);
  const computedKeys = Object.keys(computed).sort();
  const recordedKeys = Object.keys(recorded).sort();

  if (JSON.stringify(computedKeys) !== JSON.stringify(recordedKeys)) {
    return {
      ok: false,
      reason: `file list mismatch: dist/ has [${computedKeys.join(", ")}], recorded has [${recordedKeys.join(", ")}]`,
    };
  }

  for (const file of computedKeys) {
    if (computed[file] !== recorded[file]) {
      return { ok: false, reason: `hash mismatch for ${file}` };
    }
  }

  return { ok: true };
}

function main() {
  const check = process.argv.includes("--check");

  if (check) {
    const result = checkSriHashes();
    if (!result.ok) {
      console.error(
        `dist/sri-hashes.json does not match a freshly built dist/: ${result.reason}\n` +
          "Regenerate it with `node scripts/generate-sri-hashes.mjs`.",
      );
      process.exit(1);
    }
    console.log("dist/sri-hashes.json matches the current dist/ build.");
    return;
  }

  const computed = computeSriHashes();
  const hashesFile = join(DEFAULT_DIST_DIR, SRI_HASHES_FILENAME);
  writeFileSync(hashesFile, `${JSON.stringify(computed, null, 2)}\n`);
  console.log(JSON.stringify(computed, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
