import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const pkg = require("../../package.json");
const exportsMap = pkg.exports;

if (!exportsMap) {
  console.error("❌ package.json does not define an exports map!");
  process.exit(1);
}

const subpaths = Object.keys(exportsMap);
console.log("Verifying package.json exports subpaths:", subpaths);

let errors = 0;
for (const subpath of subpaths) {
  const entry = exportsMap[subpath];
  const importTarget = typeof entry === "object" ? entry.import || entry.default : entry;
  if (!importTarget) {
    console.error(`❌ Export "${subpath}" missing valid import target.`);
    errors++;
  } else {
    console.log(`  ✓ ${subpath} -> ${importTarget}`);
  }
}

if (errors > 0) {
  console.error(`\n❌ Exports map verification failed with ${errors} error(s).`);
  process.exit(1);
} else {
  console.log(`\n✅ All ${subpaths.length} package exports subpaths verified successfully!`);
}
