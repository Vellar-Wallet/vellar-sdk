#!/usr/bin/env node
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf8"));
const unpinned = [];

function checkDeps(deps, section) {
  if (!deps) return;
  for (const [name, version] of Object.entries(deps)) {
    if (version.startsWith("^") || version.startsWith("~") || version.startsWith(">")) {
      unpinned.push(`${section}: ${name}@${version}`);
    }
  }
}

checkDeps(pkg.dependencies, "dependencies");
checkDeps(pkg.devDependencies, "devDependencies");

if (unpinned.length > 0) {
  console.error("❌ Unpinned dependencies found (Supply-Chain Hardening #258):");
  unpinned.forEach((d) => console.error(`  - ${d}`));
  process.exit(1);
} else {
  console.log("✅ All dependencies and devDependencies are pinned to exact versions.");
}
