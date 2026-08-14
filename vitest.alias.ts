// Resolve `vellar-sdk/*` self-imports to SOURCE during tests.
//
// The workspace package imports the SDK by its public specifier
// (`vellar-sdk/x402-guards`), which the exports map points at `./dist`. That
// makes `npm test` depend on a prior `npm run build` — and CI runs build LAST,
// so tests failed there while passing locally on a stale dist. Aliasing to
// source removes the ordering dependency entirely: a fresh clone can run
// `npm test` with no build step, and tests exercise the real source rather than
// a build artifact that may be out of date.
//
// The alias list is DERIVED from the `source` condition already declared on
// every export, so a new subpath is covered without touching this file.
//
// NOTE: because tests no longer go through the exports map, they cannot catch a
// broken one. That is covered separately — `npm run build` still runs in CI, and
// the packaging itself is verified by packing the tarball and installing it into
// clean ESM and CJS consumers (see the PR notes).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

interface ExportEntry {
  source?: string;
}

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  name: string;
  exports: Record<string, ExportEntry | string>;
};

/** Escape a string for use inside a RegExp literal. */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * `{ ".": …, "./x402-guards": … }` → aliases for `vellar-sdk` and
 * `vellar-sdk/x402-guards`, each pointing at the declared `source` file.
 */
export const sdkSourceAliases = Object.entries(pkg.exports)
  .flatMap(([subpath, entry]) => {
    if (typeof entry === "string" || !entry?.source) return [];
    const specifier = subpath === "." ? pkg.name : `${pkg.name}${subpath.slice(1)}`;
    return [
      {
        // Anchored so `vellar-sdk/x402-untrusted` never shadows
        // `vellar-sdk/x402-untrusted-vectors`.
        find: new RegExp(`^${escapeRe(specifier)}$`),
        replacement: resolve(root, entry.source),
      },
    ];
  });
