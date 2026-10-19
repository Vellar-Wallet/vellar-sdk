// Issue #640 — keep the shipped wallet wasm hash pinned to the passkey-kit
// release it was verified against.
//
// passkey-kit does not ship the compiled wasm hash in its npm package. The
// hash lives in a deployment manifest committed to the passkey-kit repo at the
// release tag, and the README at that tag names the current manifest. This
// module reads both for an exact version and compares the manifest's
// smart-wallet hash with the one in src/config.ts.

const REPO = "stellar/passkey-kit";
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
const HASH = /^[0-9a-fA-F]{64}$/;

export class WasmHashPinError extends Error {
  constructor(message) {
    super(message);
    this.name = "WasmHashPinError";
  }
}

/** The README names its canonical manifest next to the derivation tuple. */
export function extractManifestPath(readme) {
  const m = readme.match(/`(docs\/[\w.-]+\.md)`[^\n]*canonical WASM hash/);
  if (!m) {
    throw new WasmHashPinError(
      "Could not find the 'canonical WASM hash' manifest pointer in passkey-kit's README; its phrasing may have changed.",
    );
  }
  return m[1];
}

export function extractSmartWalletHash(manifest, manifestPath) {
  const m = manifest.match(
    /\|\s*Smart wallet\s*\|\s*`smart-wallet`\s*\|[^|]*\|\s*`([0-9a-fA-F]{64})`\s*\|/,
  );
  if (!m) {
    throw new WasmHashPinError(
      `Could not find a "Smart wallet" row with a 64-hex-char hash in ${manifestPath}; the manifest table format may have changed.`,
    );
  }
  return m[1].toLowerCase();
}

/**
 * Read `walletWasmHash` from the `export const <NAME>: NetworkConfig = {...}`
 * block of src/config.ts. MAINNET is blank by design and returns "".
 */
export function extractConfiguredWasmHash(configSrc, name) {
  const block = configSrc.match(new RegExp(String.raw`export const ${name}: NetworkConfig = \{[\s\S]*?\r?\n\};`));
  if (!block) throw new WasmHashPinError(`Could not find the ${name} config block in src/config.ts.`);
  const m = block[0].match(/walletWasmHash:\s*"([^"]*)"/);
  if (!m) throw new WasmHashPinError(`Could not find walletWasmHash in the ${name} config block.`);
  const value = m[1];
  if (value !== "" && !HASH.test(value)) {
    throw new WasmHashPinError(`${name}.walletWasmHash is not a 64-char hex hash: "${value}".`);
  }
  return value.toLowerCase();
}

/**
 * Compare TESTNET.walletWasmHash with the manifest published for `version`.
 * Resolves `{ ok, expected, configured, manifestPath, version }`; throws
 * WasmHashPinError when the expected hash cannot be determined, so a network or
 * format problem is never mistaken for a pass.
 */
export async function verifyTestnetWasmHash({ configSrc, version, fetchText }) {
  if (!EXACT_VERSION.test(version)) {
    throw new WasmHashPinError(`Expected an exact version like 0.16.5, got "${version}".`);
  }
  const configured = extractConfiguredWasmHash(configSrc, "TESTNET");
  const base = `https://raw.githubusercontent.com/${REPO}/v${version}`;
  let manifestPath;
  let expected;
  try {
    manifestPath = extractManifestPath(await fetchText(`${base}/README.md`));
    expected = extractSmartWalletHash(await fetchText(`${base}/${manifestPath}`), manifestPath);
  } catch (err) {
    if (err instanceof WasmHashPinError) throw err;
    throw new WasmHashPinError(
      `Could not determine the expected wasm hash for passkey-kit@${version}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return { ok: expected === configured, expected, configured, manifestPath, version };
}
