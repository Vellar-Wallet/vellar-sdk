import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readDocSource } from "./docs";
import { DOC_PAGES, getDocPage } from "./docs-registry";

const SLUG = "getting-started/mainnet-wasm-hash";
const DOC_PATH = `website/content/docs/${SLUG}.md`;
const PLACEHOLDER = "<64-hex-char mainnet hash from this row>";
const HASH_OR_PLACEHOLDER = /^(?:[0-9a-fA-F]{64}|<64-hex-char mainnet hash from this row>)$/;

/** Model the verification the doc asks a reader to perform on the manifest. */
function selectMainnetWalletHash(manifest: string): string {
  const row = manifest
    .split("\n")
    .find((line) => /^\|\s*Mainnet\s*\|/.test(line) && line.includes("`smart-wallet`"));
  if (!row) throw new Error("no Mainnet / smart-wallet row in manifest");
  const hash = row.match(/`([^`]+)`\s*\|\s*$/)?.[1];
  if (!hash || !HASH_OR_PLACEHOLDER.test(hash)) {
    throw new Error("smart-wallet hash is not a 64-char hex value");
  }
  return hash;
}

describe("#860 — mainnet WASM hash verification guide", () => {
  const source = readDocSource(SLUG);

  it("is registered in docs navigation under Getting Started", () => {
    const page = getDocPage(SLUG);
    expect(page).toBeDefined();
    expect(page?.tab).toBe("guides");
    expect(page?.section).toBe("Getting Started");
    expect(DOC_PAGES.filter((p) => p.slug === SLUG)).toHaveLength(1);
  });

  it("walks through version lookup, tagged README, and manifest verification", () => {
    expect(source).toContain("npm list passkey-kit");
    expect(source).toContain("v<installed-version>");
    expect(source).toContain("canonical WASM hash");
    expect(source).toContain("docs/deployments-2026-08-19.md");
    expect(source).toContain("mainnetConfig({");
  });

  it("shows a worked mainnet Smart wallet row and resolves it", () => {
    const example = source.match(/```md\n([\s\S]*?)\n```/)?.[1];
    expect(example).toBeDefined();
    expect(selectMainnetWalletHash(example!)).toBe(PLACEHOLDER);
  });

  it("rejects the wrong network row, the wrong contract, and a malformed hash", () => {
    const example = source.match(/```md\n([\s\S]*?)\n```/)?.[1]!;
    expect(() => selectMainnetWalletHash(example.replace("| Mainnet |", "| Testnet |"))).toThrow(
      /Mainnet/,
    );
    expect(() =>
      selectMainnetWalletHash(example.replace(/`smart-wallet`/g, "`other-contract`")),
    ).toThrow(/Mainnet/);
    expect(() => selectMainnetWalletHash(example.replace(PLACEHOLDER, "abc"))).toThrow(/64-char/);
  });

  it("links to the error-codes reference and the quickstart", () => {
    expect(source).toContain("../reference/error-codes.md");
    expect(source).toContain("./quickstart.md");
    expect(() => readDocSource("reference/error-codes")).not.toThrow();
    expect(() => readDocSource("getting-started/quickstart")).not.toThrow();
  });

  it("is cross-linked from MAINNET in config.ts and from the README Mainnet section", () => {
    const config = readFileSync(new URL("../../src/config.ts", import.meta.url), "utf8");
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    expect(config).toContain(DOC_PATH);
    expect(readme).toContain(DOC_PATH);
    const mainnetSection = readme.slice(readme.indexOf("### Mainnet"), readme.indexOf("### Policies"));
    expect(mainnetSection).toContain("mainnet-wasm-hash.md");
  });
});
