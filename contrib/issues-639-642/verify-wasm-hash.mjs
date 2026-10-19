#!/usr/bin/env node
// Issue #640 — CI gate: TESTNET.walletWasmHash must match the passkey-kit
// deployment manifest for the installed passkey-kit version.
//   node contrib/issues-639-642/verify-wasm-hash.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { satisfiesRange } from "./passkey-release-watch.mjs";
import { verifyTestnetWasmHash, WasmHashPinError } from "./wasm-hash-pin.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...p) => readFileSync(join(root, ...p), "utf8");

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.text();
}

try {
  const peerRange = JSON.parse(read("package.json")).peerDependencies?.["passkey-kit"];
  const version = JSON.parse(read("node_modules", "passkey-kit", "package.json")).version;
  if (!peerRange) throw new WasmHashPinError("package.json declares no passkey-kit peer range.");
  if (!satisfiesRange(peerRange, version)) {
    throw new WasmHashPinError(`Installed passkey-kit@${version} is outside the declared peer range ${peerRange}.`);
  }
  const r = await verifyTestnetWasmHash({ configSrc: read("src", "config.ts"), version, fetchText });
  console.log(`passkey-kit@${r.version} manifest ${r.manifestPath}`);
  console.log(`expected   ${r.expected}\nconfigured ${r.configured}`);
  if (!r.ok) {
    console.error(
      `\nMISMATCH: update TESTNET.walletWasmHash in src/config.ts to ${r.expected} after reading the manifest ` +
        `https://github.com/stellar/passkey-kit/blob/v${r.version}/${r.manifestPath}`,
    );
    process.exitCode = 1;
  } else {
    console.log("OK: TESTNET.walletWasmHash matches the manifest.");
  }
} catch (err) {
  console.error(`verify-wasm-hash failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
