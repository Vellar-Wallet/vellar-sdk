#!/usr/bin/env node
// Tag-readiness check: run BEFORE `git tag`, so a release is never cut from a
// broken branch. Runs the same gates publish.yml runs after the tag exists
// (typecheck, test, build), plus checks that the working tree is clean and the
// tag for package.json's version does not already exist.
//
//   node contrib/audit-wave-525-529/release-check.mjs
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
const failures = [];

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const tag = `v${version}`;
console.log(`release:check for ${tag}`);

if (sh("git status --porcelain")) {
  failures.push("working tree is not clean (commit or stash changes first)");
}
if (sh(`git tag --list ${tag}`)) {
  failures.push(`tag ${tag} already exists — bump package.json version first`);
}

for (const script of ["typecheck", "test", "build"]) {
  console.log(`\n> npm run ${script}`);
  try {
    execSync(`npm run ${script}`, { stdio: "inherit" });
  } catch {
    failures.push(`npm run ${script} failed`);
    break;
  }
}

if (failures.length) {
  console.error("\nNOT ready to tag:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nReady: git tag ${tag} && git push origin ${tag}`);
