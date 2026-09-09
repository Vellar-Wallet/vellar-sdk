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
// Pages whose snippets are self-contained-in-order need nothing else. A page
// whose snippets reference free variables by design (`kit`, `sac`, ...) can
// still be checked by giving it a PREAMBLES entry that declares those names
// with their real SDK types — see the comment on PREAMBLES.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGES = [
  "website/content/docs/getting-started/quickstart.md",
  "website/content/docs/x402.md",
  "website/content/docs/buyers/pay-for-a-resource.md",
];

// Ambient declarations injected ahead of a page's snippets, for pages that
// illustrate a shape rather than a runnable program. Every type here is the
// REAL exported SDK type, never a hand-written approximation: a preamble that
// declared `sac: string` would typecheck happily while the docs drifted from
// `SacClientLike`, which is the drift this whole script exists to catch.
//
// Keep these minimal. A name belongs here only when the page deliberately
// leaves it undeclared; anything a reader is meant to copy should be in the
// snippet itself, where it gets checked.
const X402_CONFIG_PREAMBLE = `
declare const kit: import("vellar-sdk").PasskeyKitLike;
declare const sac: import("vellar-sdk").SacClientLike;
declare const backend: import("vellar-sdk").WalletBackend & {
  submitTransaction(input: {
    signedXdr: string;
    network: import("vellar-sdk").Network;
  }): Promise<{ hash: string }>;
};
declare const isValidAddress: (address: string) => boolean;
declare const walletCAddress: string;
declare const sessionKeySecret: string;
declare const aFundedGAccount: string;
`.trim();

const PREAMBLES = {
  "website/content/docs/x402.md": X402_CONFIG_PREAMBLE,
  // The closing block inspects a settlement on its own, without the
  // destructuring that introduced it two blocks earlier — each later block is
  // wrapped in its own function, so the binding does not carry over.
  "website/content/docs/buyers/pay-for-a-resource.md": [
    X402_CONFIG_PREAMBLE,
    `declare const settlement: import("vellar-sdk").X402Settlement;`,
  ].join("\n"),
};

// A preamble for a page that is no longer in PAGES silently stops applying, so
// the next person to add that page back gets a wall of errors the map was
// written to prevent. Fail on the stale key instead.
const orphaned = Object.keys(PREAMBLES).filter((page) => !PAGES.includes(page));
if (orphaned.length > 0) {
  console.error(`PREAMBLES has entries for pages not in PAGES: ${orphaned.join(", ")}`);
  process.exit(1);
}

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
    PREAMBLES[page] ?? "",
    first,
    ...wrapped,
    "export {};",
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");

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
