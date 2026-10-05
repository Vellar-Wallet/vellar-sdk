#!/usr/bin/env node
// Issue #389 — assert that src/config.ts's TESTNET.walletWasmHash matches the
// CANONICAL smart-wallet WASM hash published by the passkey-kit version
// actually installed.
//
// WHY THIS EXISTS. MAINNET/TESTNET wallet creation calls into `PasskeyKit`,
// which deploys new wallets with the configured `walletWasmHash`. If that hash
// names an old contract, wallet creation does not silently drift — it either
// fails outright (a hash with no code installed) or, worse, succeeds against a
// superseded WASM that shipped a real authorization bug since fixed upstream.
// Nothing before this script tied the configured value to the passkey-kit
// version in package.json: a contributor had to remember to re-check it by
// hand on every passkey-kit bump, and evidently didn't.
//
// THIS SCRIPT'S FIRST RUN CAUGHT A LIVE BUG: as of this writing, dev's
// `TESTNET.walletWasmHash` (`fdefad64b96837147e1c333e51f537b696eab925e9f147e63d597c04e3c903f0`)
// is passkey-kit's PRE-FIX smart-wallet hash — from
// `docs/deployments-testnet-2026-07-11.md`, contract `binver: 1.0.0` — while
// `package.json` has since moved to `passkey-kit@^0.16.5`, whose own README
// points at the LATER manifest `docs/deployments-2026-08-19.md`
// (`binver: 1.0.1`), which states: "The release fixes two authorization
// failures. Every `Signature::Policy` entry now calls `policy__`. ... A
// missing required policy now fails closed with `MissingContext`." The
// correct hash is `502ea4e7bdb3ea99880941f1d35ceb67fb598692c0bb40f842ef9c9f17d58b58`.
// See this folder's README.md for the full writeup and the exact `src/config.ts`
// diff a maintainer should apply.
//
// HOW IT WORKS. passkey-kit does not bundle the compiled WASM or its hash in
// the published npm package (only the generated contract-interface bindings,
// in the separate `passkey-kit-sdk` package) — the hash lives in a manifest
// committed to the passkey-kit GitHub repo, at the tag matching the release.
// So "compute the expected hash" here means: read the installed version,
// fetch that tag's README (which names its own canonical manifest — the repo
// re-pins this pointer on every contract change), fetch that manifest, and
// pull the smart-wallet row's SHA-256.
//
// USAGE (once lifted into core — see README.md "Integration into Core"):
//   node contrib/v389-v386-v383-v390/verify-wallet-wasm-hash.mjs
// Wire into .github/workflows/ci.yml (after `npm run typecheck`) and into
// `prepublishOnly` in package.json.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO = "stellar/passkey-kit";

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status}`);
  }
  return res.text();
}

function installedPasskeyKitVersion() {
  const pkgPath = join(ROOT, "node_modules", "passkey-kit", "package.json");
  let raw;
  try {
    raw = readFileSync(pkgPath, "utf8");
  } catch {
    throw new Error(
      `Could not read ${pkgPath}. Run \`npm ci\` first — this check needs the ` +
        "installed passkey-kit version, not just the declared range.",
    );
  }
  const version = JSON.parse(raw).version;
  if (!version) throw new Error(`node_modules/passkey-kit/package.json has no "version" field.`);
  return version;
}

function configuredTestnetHash() {
  const configPath = join(ROOT, "src", "config.ts");
  const src = readFileSync(configPath, "utf8");
  const testnetBlock = src.match(/export const TESTNET: NetworkConfig = \{[\s\S]*?\n\};/);
  if (!testnetBlock) {
    throw new Error(`Could not find the TESTNET config block in ${configPath}.`);
  }
  const m = testnetBlock[0].match(/walletWasmHash:\s*"([0-9a-fA-F]{64})"/);
  if (!m) {
    throw new Error(`Could not find a 64-hex-char walletWasmHash in TESTNET config block.`);
  }
  return m[1].toLowerCase();
}

/**
 * The passkey-kit README names its own current canonical manifest next to the
 * normative address-derivation tuple, e.g.:
 *   "...must never change. See `docs/deployments-2026-08-19.md` for the
 *   canonical WASM hash, upload transactions, and upgrade guidance."
 * That sentence is the maintainers' own pointer to which of possibly several
 * `docs/deployments-*.md` files is current — parsed here rather than guessed
 * at from filenames, since supersession is not always the lexicographically
 * latest date (a testnet-only re-pin can postdate a combined manifest).
 */
function canonicalManifestPathFrom(readme) {
  const m = readme.match(/`(docs\/[\w.-]+\.md)`[^\n]*canonical WASM hash/);
  if (!m) {
    throw new Error(
      "Could not find the 'canonical WASM hash' manifest pointer in passkey-kit's README. " +
        "The README's phrasing may have changed — update the regex in this script.",
    );
  }
  return m[1];
}

function smartWalletHashFrom(manifest, manifestPath) {
  const m = manifest.match(
    /\|\s*Smart wallet\s*\|\s*`smart-wallet`\s*\|[^|]*\|\s*`([0-9a-fA-F]{64})`\s*\|/,
  );
  if (!m) {
    throw new Error(
      `Could not find a "Smart wallet" row with a 64-hex-char hash in ${manifestPath}. ` +
        "The manifest's table format may have changed.",
    );
  }
  return m[1].toLowerCase();
}

async function main() {
  const version = installedPasskeyKitVersion();
  const tag = `v${version}`;
  console.log(`passkey-kit installed: ${version} (tag ${tag})`);

  let readme, manifestPath, manifest, expected;
  try {
    readme = await fetchText(`https://raw.githubusercontent.com/${REPO}/${tag}/README.md`);
    manifestPath = canonicalManifestPathFrom(readme);
    console.log(`Canonical manifest per README: ${manifestPath}`);
    manifest = await fetchText(`https://raw.githubusercontent.com/${REPO}/${tag}/${manifestPath}`);
    expected = smartWalletHashFrom(manifest, manifestPath);
  } catch (err) {
    console.error(
      `\nCould not determine the expected wasm hash for passkey-kit@${version}: ${err.message}\n\n` +
        "This may be a transient network problem, or passkey-kit may have renamed/moved its " +
        `deployment manifest. Verify by hand: https://github.com/${REPO}/blob/${tag}/README.md\n`,
    );
    process.exitCode = 1;
    return;
  }

  const configured = configuredTestnetHash();
  console.log(`Expected (passkey-kit@${version}, ${manifestPath}): ${expected}`);
  console.log(`Configured (src/config.ts TESTNET.walletWasmHash):  ${configured}`);

  if (expected !== configured) {
    console.error(
      `\nMISMATCH — src/config.ts's TESTNET.walletWasmHash does not match the canonical ` +
        `smart-wallet WASM hash for the installed passkey-kit@${version}.\n\n` +
        "Wallet creation against this hash either fails outright (no such code installed) " +
        "or succeeds against a superseded contract — see the manifest below for what changed:\n" +
        `  https://github.com/${REPO}/blob/${tag}/${manifestPath}\n\n` +
        `To fix: set walletWasmHash to "${expected}" in src/config.ts, after reading the ` +
        "manifest above to confirm this is an intended upgrade.\n",
    );
    process.exitCode = 1;
    return;
  }

  console.log("\nOK — TESTNET.walletWasmHash matches the installed passkey-kit version.");
}

await main();
