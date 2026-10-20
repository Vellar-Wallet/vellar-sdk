import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditDependencyDrift, satisfiesRange } from "./dependency-drift.mjs";

const fixtureDirectory = path.join(
  process.cwd(),
  "contrib/workspace-release-safety/fixtures/current-drift",
);

async function fixture(name: string) {
  return JSON.parse(await readFile(path.join(fixtureDirectory, name), "utf8"));
}

describe("workspace dependency drift", () => {
  it("uses npm-compatible caret behavior for zero-major releases", () => {
    expect(satisfiesRange("0.6.2", "^0.6.1")).toBe(true);
    expect(satisfiesRange("0.7.0", "^0.6.1")).toBe(false);
    expect(satisfiesRange("1.4.0", "^1.2.3")).toBe(true);
  });

  it("supports comparator, tilde, wildcard, and hyphen ranges", () => {
    expect(satisfiesRange("0.6.2", ">=0.6.0 <0.7.0")).toBe(true);
    expect(satisfiesRange("0.6.2", "~0.6.1")).toBe(true);
    expect(satisfiesRange("0.6.2", "0.6.x")).toBe(true);
    expect(satisfiesRange("0.6.2", "0.6.0 - 0.6.2")).toBe(true);
  });

  it("reproduces the current MCP payer stale-minimum drift from fixtures", async () => {
    const results = auditDependencyDrift({
      rootManifest: await fixture("root.package.json"),
      workspaceManifests: [
        await fixture("cli.package.json"),
        await fixture("mcp.package.json"),
      ],
    });

    expect(results).toEqual([
      expect.objectContaining({
        packageName: "vellar-cli",
        range: "^0.6.2",
        status: "aligned",
        fails: false,
      }),
      expect.objectContaining({
        packageName: "vellar-mcp-x402-payer",
        range: "^0.6.1",
        compatible: true,
        staleMinimum: true,
        status: "stale-minimum",
        fails: true,
      }),
    ]);
  });

  it("fails when a workspace range excludes the current root version", () => {
    const [result] = auditDependencyDrift({
      rootManifest: { name: "vellar-sdk", version: "0.7.0" },
      workspaceManifests: [{
        name: "vellar-cli",
        dependencies: { "vellar-sdk": "^0.6.2" },
      }],
    });

    expect(result).toMatchObject({ compatible: false, status: "incompatible", fails: true });
  });

  it("can enforce compatibility without enforcing an aligned minimum", () => {
    const [result] = auditDependencyDrift({
      rootManifest: { name: "vellar-sdk", version: "0.6.2" },
      workspaceManifests: [{
        name: "vellar-mcp-x402-payer",
        dependencies: { "vellar-sdk": "^0.6.1" },
      }],
      strictMinimum: false,
    });

    expect(result).toMatchObject({ status: "stale-minimum", fails: false });
  });

  it("rejects non-semver protocols instead of silently misclassifying them", () => {
    expect(() => satisfiesRange("0.6.2", "workspace:^0.6.2")).toThrow("Non-semver");
  });
});
