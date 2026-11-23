#!/usr/bin/env node
/**
 * Fail when NetworkConfig in src/config.ts gains a field that
 * contrib/network-config-853-856/network-config.md does not mention.
 *
 * Wire into CI next to `npm test`:
 *   node contrib/network-config-853-856/check-network-config-fields.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const config = fs.readFileSync(path.join(root, "src/config.ts"), "utf8");
const doc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "network-config.md"), "utf8");

const block = config.match(/export interface NetworkConfig \{([\s\S]*?)\n\}/);
if (!block) {
  console.error("Could not find export interface NetworkConfig in src/config.ts");
  process.exit(1);
}

const fields = [];
for (const line of block[1].split("\n")) {
  const match = line.match(/^\s+(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\??:/);
  if (match) fields.push(match[1]);
}

if (fields.length === 0) {
  console.error("NetworkConfig interface had no fields");
  process.exit(1);
}

const missing = fields.filter((field) => !doc.includes(`\`${field}\``));
if (missing.length > 0) {
  console.error(
    "NetworkConfig field(s) missing from network-config.md: " + missing.join(", "),
  );
  console.error("Add a row (version + one-line migration note) in the same change.");
  process.exit(1);
}

console.log(`NetworkConfig fields documented: ${fields.join(", ")}`);
