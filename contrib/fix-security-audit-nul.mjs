#!/usr/bin/env node
// Fix stray NUL byte in docs/security-audit.md (issue #385).
//
// The security audit doc contains a code snippet with literal control
// characters (from the CONTROL_AND_FORMAT regex). This script replaces
// them with their Unicode escape sequences so the file reports as text.
//
// Run from the repo root:
//   node contrib/fix-security-audit-nul.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const file = resolve(root, "docs/security-audit.md");

const data = readFileSync(file);
const positions = [...data].reduce((acc, byte, i) => {
  if (byte === 0) acc.push(i);
  return acc;
}, []);

if (positions.length === 0) {
  // Check for literal control chars in the regex area
  const text = data.toString("utf8");
  const controlChars = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;
  let match;
  const found = [];
  while ((match = controlChars.exec(text)) !== null) {
    found.push({ pos: match.index, char: text.charCodeAt(match.index) });
  }
  if (found.length === 0) {
    console.log("No NUL bytes or stray control characters found.");
    process.exit(0);
  }
  console.log(`Found ${found.length} literal control characters. Fixing...`);

  // The regex area in the doc: after "\\u0000-" there are literal control chars
  // that should be Unicode escape sequences.
  let fixed = text;
  // Replace the specific pattern: literal control chars in the regex display
  const idx = fixed.indexOf("\\u0000-");
  if (idx !== -1) {
    const after = fixed.slice(idx + 7);
    // Match the literal control chars followed by the rest of the regex
    const ctrlMatch = after.match(/^[\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]+/);
    if (ctrlMatch) {
      const escaped = Array.from(ctrlMatch[0])
        .map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)
        .join("");
      fixed = fixed.slice(0, idx + 7) + escaped + after.slice(ctrlMatch[0].length);
    }
  }

  writeFileSync(file, fixed, "utf8");
  console.log("Fixed. Run `file docs/security-audit.md` to verify it reports as text.");
} else {
  console.log(`Found NUL byte(s) at position(s): ${positions.join(", ")}`);
  const fixed = Buffer.from(data.filter((b) => b !== 0));
  writeFileSync(file, fixed);
  console.log("Removed NUL byte(s). Run `file docs/security-audit.md` to verify.");
}