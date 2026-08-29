#!/usr/bin/env node
// Decide the npm dist-tag a publish should use, from the git tag it runs from.
//
// WHY THIS IS ITS OWN SCRIPT (not inlined in publish.yml): the decision —
// "does this look like a canary?" — is exactly the kind of one-line regex
// that's easy to get subtly wrong inside a YAML `run:` block (quoting,
// escaping, and no way to unit-test it in isolation). Pulling it out means
// the logic that decides where a release goes can be tested the same way any
// other release-affecting logic in this repo is (see verify-merged.mjs).
//
// Rule: a semver PRERELEASE tag (anything with a `-` suffix, e.g.
// `v0.7.0-canary.0`, `v0.7.0-canary.1`, `v0.7.0-rc.0`) publishes to the
// `next` dist-tag. A plain release tag (`v0.7.0`) publishes to `latest`.
// This mirrors ordinary semver prerelease convention (see semver.org) rather
// than inventing a bespoke "canary" grammar — any prerelease identifier
// works, `canary` is simply the one this project's process names.
//
// Usage:
//   node scripts/npm-dist-tag-for.mjs v0.7.0-canary.0   ->  next
//   node scripts/npm-dist-tag-for.mjs v0.7.0            ->  latest
//   node scripts/npm-dist-tag-for.mjs --selftest        ->  runs the cases below

/**
 * @param {string} tag a `v`-prefixed git tag, e.g. "v0.7.0-canary.0"
 * @returns {"next" | "latest"}
 */
export function distTagFor(tag) {
  const version = tag.replace(/^v/, "");
  const isPrerelease = /-/.test(version);
  return isPrerelease ? "next" : "latest";
}

const CASES = [
  ["v0.7.0-canary.0", "next"],
  ["v0.7.0-canary.1", "next"],
  ["v1.0.0-rc.0", "next"],
  ["v0.7.0", "latest"],
  ["v1.0.0", "latest"],
  ["v0.6.1", "latest"],
];

function selftest() {
  let failed = 0;
  for (const [tag, expected] of CASES) {
    const got = distTagFor(tag);
    const ok = got === expected;
    if (!ok) failed++;
    console.log(`  ${ok ? "ok" : "FAIL"}  ${tag} -> ${got}${ok ? "" : ` (expected ${expected})`}`);
  }
  console.log(`\n  ${CASES.length} case(s), ${failed} failed.`);
  process.exit(failed ? 1 : 0);
}

// Only run the CLI when this file is executed directly (`node
// scripts/npm-dist-tag-for.mjs ...`), not when imported by the test file.
// Compared via pathToFileURL (not a raw `file://` template) so this also
// works on Windows, where argv[1] uses backslashes.
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv[2];
  if (arg === "--selftest") {
    selftest();
  } else if (!arg) {
    console.error("usage: node scripts/npm-dist-tag-for.mjs <git-tag>   |   --selftest");
    process.exit(2);
  } else {
    console.log(distTagFor(arg));
  }
}
