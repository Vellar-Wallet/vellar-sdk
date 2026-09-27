#!/usr/bin/env node
/**
 * Verification script for package.json exports map (Issue #393).
 *
 * Verifies that the built output (dist/) resolves and exports all declared
 * subpaths cleanly for both ESM (import) and CJS (require) consumers.
 */

import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);

const SUBPATHS = [
  { name: "root", file: "index" },
  { name: "balances", file: "balances" },
  { name: "rpc", file: "rpc" },
  { name: "x402-guards", file: "x402-guards" },
  { name: "x402-untrusted", file: "x402-untrusted" },
  { name: "x402-untrusted-vectors", file: "x402-untrusted-vectors" },
];

console.log("--> Building package with tsup...");
execSync("npm run build", { stdio: "inherit" });

let failed = 0;

for (const sub of SUBPATHS) {
  const esmPath = resolve(process.cwd(), `dist/${sub.file}.js`);
  const cjsPath = resolve(process.cwd(), `dist/${sub.file}.cjs`);

  // Test ESM import
  if (!existsSync(esmPath)) {
    console.error(`FAIL: ESM built output missing for ${sub.name} at ${esmPath}`);
    failed++;
  } else {
    try {
      const url = pathToFileURL(esmPath).href;
      const mod = await import(url);
      if (!mod) throw new Error("Import returned falsy module");
      console.log(`  OK  [ESM import]  ${sub.name} -> dist/${sub.file}.js`);
    } catch (err) {
      console.error(`FAIL [ESM import]  ${sub.name}:`, err);
      failed++;
    }
  }

  // Test CJS require
  if (!existsSync(cjsPath)) {
    console.error(`FAIL: CJS built output missing for ${sub.name} at ${cjsPath}`);
    failed++;
  } else {
    try {
      const mod = require(cjsPath);
      if (!mod) throw new Error("Require returned falsy module");
      console.log(`  OK  [CJS require] ${sub.name} -> dist/${sub.file}.cjs`);
    } catch (err) {
      console.error(`FAIL [CJS require] ${sub.name}:`, err);
      failed++;
    }
  }
}

if (failed > 0) {
  console.error(`\nFAILED: ${failed} export map resolution check(s) failed.`);
  process.exit(1);
}

console.log("\nPASSED: All published exports subpaths resolved and imported successfully!");
process.exit(0);
