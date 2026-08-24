#!/usr/bin/env node
// Typecheck the docs' code snippets against the CURRENT SDK source, so a
// quickstart that drifts from the real API fails CI instead of failing the
// first participant who copy-pastes it (the way `TESTNET.nativeTokenId` did).
//
// How: extract every ```ts fence from each listed page, hoist import lines to
// the top (deduped), keep the FIRST block's body at top level (it declares the
// shared setup later blocks reference), wrap each later block in its own async
// function (so `await` works and repeated `const session = ...` declarations
// don't collide), then run `tsc --noEmit` over the result with `vellar-sdk`
// path-mapped to ./src. passkey-kit and @stellar/stellar-sdk resolve from
// node_modules like any import.
//
// Only pages whose snippets are self-contained-in-order belong in PAGES —
// most other pages' snippets reference free variables (`kit`, `sac`, ...) by
// design and cannot typecheck standalone.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGES = ["website/content/docs/quickstart.md"];

const outDir = path.join(root, ".doc-snippets");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

let extracted = 0;
for (const page of PAGES) {
  const md = readFileSync(path.join(root, page), "utf8");
  const blocks = [...md.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (blocks.length === 0) continue;

  const imports = new Set();
  const bodies = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const body = [];
    let inImport = false;
    for (const line of lines) {
      if (inImport || /^import[\s{]/.test(line)) {
        imports.add(line);
        inImport = !/from\s+["'][^"']+["'];?\s*$/.test(line);
      } else {
        body.push(line);
      }
    }
    bodies.push(body.join("\n").trim());
  }

  const [first, ...rest] = bodies;
  const wrapped = rest
    .filter((b) => b.length > 0)
    .map((b, i) => `async function __snippet_${i + 2}() {\n${b}\n}\nvoid __snippet_${i + 2};`);
  const file = [
    `// GENERATED from ${page} by scripts/check-doc-snippets.mjs — do not edit.`,
    [...imports].join("\n"),
    first,
    ...wrapped,
    "export {};",
  ].join("\n\n");

  const name = path.basename(page, ".md") + ".snippets.ts";
  writeFileSync(path.join(outDir, name), file);
  extracted += blocks.length;
  console.log(`extracted ${blocks.length} ts block(s) from ${page} -> .doc-snippets/${name}`);
}

if (extracted === 0) {
  console.error("no ts snippets extracted — PAGES out of date?");
  process.exit(1);
}

writeFileSync(
  path.join(outDir, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        noEmit: true,
        strict: true,
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        lib: ["ES2022", "DOM"],
        skipLibCheck: true,
        baseUrl: ".",
        paths: { "vellar-sdk": ["../src/index.ts"], "vellar-sdk/*": ["../src/*"] },
      },
      include: ["*.ts"],
    },
    null,
    2,
  ),
);

try {
  execFileSync("npx", ["tsc", "--noEmit", "-p", outDir], { cwd: root, stdio: "inherit" });
} catch {
  console.error("\ndoc snippets failed to typecheck against the current SDK — fix the docs (or the API drift) before merging.");
  process.exit(1);
}
console.log("doc snippets typecheck clean");
