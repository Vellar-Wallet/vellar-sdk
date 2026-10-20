import { describe, expect, it } from "vitest";
import {
  auditReadmePackageName,
  extractInstalledPackageNames,
} from "./readme-package-name.mjs";

describe("README package-name guard", () => {
  it("extracts package names from npm install commands", () => {
    const markdown = [
      "```sh",
      "npm install vellar-sdk@^0.6.2 @stellar/stellar-sdk passkey-kit",
      "npm i -g vellar-cli",
      "```",
    ].join("\n");

    expect(extractInstalledPackageNames(markdown)).toEqual([
      "vellar-sdk",
      "@stellar/stellar-sdk",
      "passkey-kit",
      "vellar-cli",
    ]);
  });

  it("accepts a README whose install command names its package", () => {
    const result = auditReadmePackageName({
      manifest: { name: "vellar-mcp-x402-payer" },
      markdown: "```sh\nnpm install vellar-mcp-x402-payer\n```",
    });
    expect(result.valid).toBe(true);
  });

  it("catches a renamed package with stale install instructions", () => {
    const result = auditReadmePackageName({
      manifest: { name: "@vellar/mcp-x402-payer" },
      markdown: "```sh\nnpm install vellar-mcp-x402-payer\n```",
      readmePath: "packages/mcp-x402-payer/README.md",
    });
    expect(result).toMatchObject({
      valid: false,
      packageName: "@vellar/mcp-x402-payer",
      installedNames: ["vellar-mcp-x402-payer"],
    });
  });

  it("does not treat prose or non-install commands as install instructions", () => {
    const result = auditReadmePackageName({
      manifest: { name: "vellar-cli" },
      markdown: "Use vellar-cli.\n```sh\nnpx vellar-cli --help\n```",
    });
    expect(result.valid).toBe(false);
  });

  it("requires a manifest package name", () => {
    expect(() => auditReadmePackageName({ manifest: {}, markdown: "" })).toThrow(
      "must declare a name",
    );
  });
});
