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
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Pages whose ```ts fences are typechecked against the live SDK source.
//
// Grown incrementally, one page at a time: adding a page is how drift gets
// found, so a page is added because it contains snippets a reader could
// copy-paste, not because it is easy. Every entry here has either runnable
// snippets in order (no preamble needed) or a PREAMBLES entry below declaring
// the names it deliberately leaves free.
//
// A page with ```ts fences that is NOT listed here is unchecked, which is the
// gap this list is being closed against. `npm run check:docs` prints the
// unchecked pages at the end so the backlog stays visible rather than silently
// tolerated.
const PAGES = [
  "website/content/docs/getting-started/quickstart.md",
  "website/content/docs/getting-started/installation.md",
  "website/content/docs/x402.md",
  "website/content/docs/buyers/pay-for-a-resource.md",
  "website/content/docs/buyers/discover-services.md",
  "website/content/docs/buyers/spend-controls.md",
  "website/content/docs/agent-tooling/agent-keys.md",
  "website/content/docs/agent-tooling/policies.md",
  "website/content/docs/agent-tooling/vscode.md",
  "website/content/docs/sellers/charge-for-an-endpoint.md",
  "website/content/docs/sellers/upto-metered-payments.md",
  "website/content/docs/facilitator.md",
  "website/content/docs/api-reference.md",
  "website/content/docs/advanced.md",
  "website/content/docs/upto.md",
  "website/content/docs/wallet-methods.md",
  "website/content/docs/architecture/spending-policies.md",
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

// Pages that document a facilitator-side SHAPE. These snippets are
// configuration fragments lifted out of their surrounding object literal, so
// they are not standalone programs and cannot be run as one. What still gets
// checked is the part that matters: the property names, value types and the
// constructor signatures they are passed to. A renamed SDK export or a changed
// constructor argument still fails here.
const FACILITATOR_SHAPE_PREAMBLE = `
declare const server: {
  register(network: string, scheme: unknown): void;
};
declare const facilitator: {
  settle(input: {
    paymentPayload: string;
    paymentRequirements: Record<string, unknown>;
  }): Promise<{ amount?: string; transaction?: string }>;
};
declare const paymentPayload: string;
declare const requirements: Record<string, unknown>;
declare const result: { tokensGenerated: number };
declare const request: unknown;
`.trim();

const PREAMBLES = {
  "website/content/docs/facilitator.md": FACILITATOR_SHAPE_PREAMBLE,
  "website/content/docs/sellers/upto-metered-payments.md": FACILITATOR_SHAPE_PREAMBLE,
  // The `upto` page shows the two fields that differ from `exact` — the buyer
  // ceiling on the requirements, and `actualAmount` on the settled extras —
  // each as a bare object literal.
  "website/content/docs/upto.md": FACILITATOR_SHAPE_PREAMBLE,
  // A full MCP client config object, spread across several fences.
  "website/content/docs/agent-tooling/vscode.md": `
declare const mcpServers: Record<string, unknown>;
`.trim(),
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

// Pages that MIX runnable statements with config fragments, so the kind of each
// individual fence decides how it is compiled rather than the page as a whole.
const MIXED_PAGES = new Set([
  "website/content/docs/sellers/upto-metered-payments.md",
  "website/content/docs/upto.md",
  "website/content/docs/agent-tooling/vscode.md",
]);

/**
 * Is this block a bare object-literal FRAGMENT rather than statements?
 *
 * Decided per block, because a page can show a `server.register(...)` call in
 * one fence and a bare `{ amount: "..." }` in the next. The test is structural:
 * a fragment's first meaningful line opens an object literal, so it carries a
 * top-level property and has no statement of its own.
 */
function isFragment(body) {
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*"));
  if (lines.length === 0) return false;

  const first = lines[0];
  // A fragment is a lone property (`amount: "1000000"`) or a literal that opens
  // an object (`{`). Anything that starts a statement is not one.
  if (first.startsWith("{")) return true;
  if (!/^[A-Za-z_$][\w$]*\s*[:,]/.test(first)) return false;
  // A lone `key: value,` is a fragment only if no statement keyword appears.
  return !/^(const|let|var|return|await|import|export|function|throw|if|for|while|class)\b/.test(
    first,
  );
}

const outDir = path.join(root, ".doc-snippets");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

/**
 * The type a config fragment is checked against.
 *
 * The x402 requirements shape merged with the route-config fields a facilitator
 * adds (`price`, `description`, `uptoContract`, MCP client keys), so a
 * misspelled property still fails. Declared here rather than imported because
 * these are FACILITATOR-internal shapes: the SDK's `PaymentRequirements` is the
 * flattened wire form and carries no `price`, so borrowing it would reject
 * correct documentation.
 */
const FRAGMENT_TYPE = `{
  [key: string]: unknown;
  scheme?: string;
  network?: string;
  asset?: string;
  amount?: string;
  payTo?: string;
  price?: { asset?: string; amount?: string | bigint };
  extra?: Record<string, unknown>;
  maxTimeoutSeconds?: number;
  description?: string;
}`;

let fragmentCount = 0;

/**
 * Wrap a config fragment so it parses as an object literal, not a block.
 *
 * The annotated type already ends in `= {`, so the initializer's braces are
 * supplied. A fragment written in the docs as a complete `{ … }` literal has
 * its own pair, which is stripped here; a bare `key: value` fragment has none
 * and is dropped straight in.
 */
function wrapFragment(body, index) {
  fragmentCount += 1;
  const lines = body.trim().startsWith("{") ? stripOuterBraces(body) : body.split("\n");
  return [
    `const __fragment_${index}: ${FRAGMENT_TYPE} = {`,
    ...lines,
    "};",
    `void __fragment_${index};`,
  ].join("\n");
}

/** Remove exactly one balanced pair of outer braces, and the blank edges with it. */
function stripOuterBraces(body) {
  const lines = body.split("\n");
  let start = lines.findIndex((l) => l.trim().length > 0);
  let end = lines.length - 1;
  while (end > start && lines[end].trim().length === 0) end -= 1;
  return lines.slice(start + 1, end);
}

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

  const mixed = MIXED_PAGES.has(page);
  const nonEmpty = bodies.filter((b) => b.length > 0);

  // The FIRST non-empty block stays at top level: it is the page's shared setup,
  // and the bindings it declares are referenced by the later blocks. Everything
  // after it gets its own scope, since each is wrapped in a function.
  //
  // The exception is a first block that is itself a fragment on a mixed page:
  // there is no setup to hoist, and a bare `{ … }` at top level parses as a
  // block rather than an object literal, so it has to be wrapped like the rest.
  const [first, ...rest] = nonEmpty;
  const firstIsFragment = mixed && isFragment(first);

  let n = 0;
  const wrap = (b) => {
    n += 1;
    if (mixed && isFragment(b)) return wrapFragment(b, n);
    return `async function __snippet_${n}() {\n${b}\n}\nvoid __snippet_${n};`;
  };

  const file = [
    `// GENERATED from ${page} by scripts/check-doc-snippets.mjs — do not edit.`,
    [...imports].join("\n"),
    PREAMBLES[page] ?? "",
    firstIsFragment ? wrap(first) : first,
    ...rest.map(wrap),
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

// Report, do not fail: the point of the list is that it grows. Naming what is
// still unchecked keeps the remaining drift visible instead of letting an
// unlisted page look covered by the fact that CI is green.
const docsDir = path.join(root, "website/content/docs");
const checked = new Set(PAGES.map((p) => path.resolve(root, p)));
const unchecked = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".md")) {
      const md = readFileSync(full, "utf8");
      if (/```ts\n/.test(md) && !checked.has(full)) {
        const blocks = [...md.matchAll(/```ts\n([\s\S]*?)```/g)].length;
        unchecked.push(`${path.relative(root, full)} (${blocks} block(s))`);
      }
    }
  }
})(docsDir);

if (unchecked.length > 0) {
  console.log(
    `\n${unchecked.length} page(s) with ts snippets are still UNCHECKED — add them to PAGES in ` +
      `scripts/check-doc-snippets.mjs:\n  ${unchecked.join("\n  ")}`,
  );
}
