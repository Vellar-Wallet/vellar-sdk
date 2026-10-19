import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAINNET, TESTNET } from "../../src/config";
import {
  extractConfiguredWasmHash,
  extractManifestPath,
  extractSmartWalletHash,
  verifyTestnetWasmHash,
  WasmHashPinError,
} from "./wasm-hash-pin.mjs";

const HASH_A = "502ea4e7bdb3ea99880941f1d35ceb67fb598692c0bb40f842ef9c9f17d58b58";
const HASH_B = "fdefad64b96837147e1c333e51f537b696eab925e9f147e63d597c04e3c903f0";

const README = `## Deterministic derivation
This tuple is normative and must never change. See [\`docs/deployments-2026-08-19.md\`](./docs/deployments-2026-08-19.md) for the canonical WASM hash, upload transactions, and upgrade guidance.
`;

const manifest = (hash: string) => `# Deployments
| Contract | Kind | Network | Hash |
| --- | --- | --- | --- |
| Smart wallet | \`smart-wallet\` | testnet | \`${hash}\` |
`;

const configSrc = (hash: string) => `export const TESTNET: NetworkConfig = {
  network: "testnet",
  walletWasmHash: "${hash}",
  nativeTokenContractId: "C",
};

export const MAINNET: NetworkConfig = {
  network: "mainnet",
  walletWasmHash: "",
};
`;

function fakeFetch(files: Record<string, string>) {
  const urls: string[] = [];
  const fetchText = async (url: string) => {
    urls.push(url);
    const hit = Object.entries(files).find(([suffix]) => url.endsWith(suffix));
    if (!hit) throw new Error(`GET ${url} -> HTTP 404`);
    return hit[1];
  };
  return { fetchText, urls };
}

describe("extractManifestPath", () => {
  it("reads the canonical manifest pointer from the passkey-kit README", () => {
    expect(extractManifestPath(README)).toBe("docs/deployments-2026-08-19.md");
  });

  it("throws a clear error when the pointer phrase is gone", () => {
    expect(() => extractManifestPath("# nothing here")).toThrow(WasmHashPinError);
    expect(() => extractManifestPath("# nothing here")).toThrow(/canonical WASM hash/);
  });
});

describe("extractSmartWalletHash", () => {
  it("reads and lower-cases the smart-wallet row", () => {
    expect(extractSmartWalletHash(manifest(HASH_A.toUpperCase()), "m.md")).toBe(HASH_A);
  });

  it("throws when the table has no smart-wallet row", () => {
    expect(() => extractSmartWalletHash("| a | b |", "m.md")).toThrow(/m\.md/);
  });
});

describe("extractConfiguredWasmHash", () => {
  it("reads the TESTNET hash", () => {
    expect(extractConfiguredWasmHash(configSrc(HASH_B), "TESTNET")).toBe(HASH_B);
  });

  it("returns an empty string for MAINNET, which is blank by design", () => {
    expect(extractConfiguredWasmHash(configSrc(HASH_B), "MAINNET")).toBe("");
  });

  it("throws when the block or field is missing or malformed", () => {
    expect(() => extractConfiguredWasmHash("export const X = {};", "TESTNET")).toThrow(WasmHashPinError);
    expect(() => extractConfiguredWasmHash(configSrc("nothex"), "TESTNET")).toThrow(WasmHashPinError);
  });

  it("agrees with the real exported constants in src/config.ts", () => {
    const src = readFileSync(join(__dirname, "..", "..", "src", "config.ts"), "utf8");
    expect(extractConfiguredWasmHash(src, "TESTNET")).toBe(TESTNET.walletWasmHash.toLowerCase());
    expect(extractConfiguredWasmHash(src, "MAINNET")).toBe(MAINNET.walletWasmHash);
  });
});

describe("verifyTestnetWasmHash", () => {
  const files = {
    "/v0.16.5/README.md": README,
    "/v0.16.5/docs/deployments-2026-08-19.md": manifest(HASH_A),
  };

  it("passes when the shipped hash matches the manifest for the exact version", async () => {
    const { fetchText, urls } = fakeFetch(files);
    const result = await verifyTestnetWasmHash({
      configSrc: configSrc(HASH_A),
      version: "0.16.5",
      fetchText,
    });
    expect(result).toMatchObject({ ok: true, expected: HASH_A, configured: HASH_A });
    expect(urls[0]).toContain("/stellar/passkey-kit/v0.16.5/");
  });

  it("reports a mismatch with both hashes and the manifest path", async () => {
    const { fetchText } = fakeFetch(files);
    const result = await verifyTestnetWasmHash({
      configSrc: configSrc(HASH_B),
      version: "0.16.5",
      fetchText,
    });
    expect(result).toMatchObject({
      ok: false,
      expected: HASH_A,
      configured: HASH_B,
      manifestPath: "docs/deployments-2026-08-19.md",
    });
  });

  it("throws WasmHashPinError when the tag cannot be fetched", async () => {
    const { fetchText } = fakeFetch({});
    await expect(
      verifyTestnetWasmHash({ configSrc: configSrc(HASH_A), version: "0.16.5", fetchText }),
    ).rejects.toThrow(WasmHashPinError);
  });

  it("throws WasmHashPinError when the manifest cannot be parsed", async () => {
    const { fetchText } = fakeFetch({ ...files, "/v0.16.5/docs/deployments-2026-08-19.md": "empty" });
    await expect(
      verifyTestnetWasmHash({ configSrc: configSrc(HASH_A), version: "0.16.5", fetchText }),
    ).rejects.toThrow(/Smart wallet|smart-wallet/i);
  });

  it("rejects a version that is not exact semver", async () => {
    const { fetchText } = fakeFetch(files);
    await expect(
      verifyTestnetWasmHash({ configSrc: configSrc(HASH_A), version: "^0.16.5", fetchText }),
    ).rejects.toThrow(/exact version/);
  });
});
