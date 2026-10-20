import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditRepositoryReadmes } from "./readme-package-name.mjs";

const proposalDirectory = path.join(process.cwd(), "contrib/workspace-release-safety");

describe("workspace release proposal", () => {
  it("matches every current package README install command to its manifest name", async () => {
    const results = await auditRepositoryReadmes(process.cwd());
    expect(results.map((result) => result.packageName).sort()).toEqual([
      "vellar-cli",
      "vellar-mcp-x402-payer",
      "vellar-sdk",
    ]);
    expect(results.every((result) => result.valid)).toBe(true);
  });

  it("pins the Changesets proposal to the contributor target branch", async () => {
    const config = JSON.parse(
      await readFile(path.join(proposalDirectory, "proposed-changesets-config.json"), "utf8"),
    );
    expect(config).toMatchObject({
      access: "public",
      baseBranch: "dev",
      updateInternalDependencies: "patch",
    });
  });

  it.each([
    ["vellar-cli", "0.1.1"],
    ["vellar-mcp-x402-payer", "0.1.5"],
  ])("provides a baseline changelog for %s", async (packageName, version) => {
    const changelog = await readFile(
      path.join(proposalDirectory, "proposed-changelogs", `${packageName}.md`),
      "utf8",
    );
    expect(changelog).toContain(`# ${packageName}`);
    expect(changelog).toContain(`## ${version}`);
  });
});
