import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { auditNodeEngines, oldestSupportedNode } from "./check-node-engines.mjs";

const roots: string[] = [];

async function fixture(rootRange?: string, cliRange = ">=20", payerRange = ">=20") {
  const root = await mkdtemp(join(tmpdir(), "vellar-node-matrix-"));
  roots.push(root);
  await mkdir(join(root, "packages", "cli"), { recursive: true });
  await mkdir(join(root, "packages", "payer"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "vellar-sdk",
      workspaces: ["packages/*"],
      ...(rootRange ? { engines: { node: rootRange } } : {}),
    }),
  );
  await writeFile(
    join(root, "packages", "cli", "package.json"),
    JSON.stringify({ name: "vellar-cli", engines: { node: cliRange } }),
  );
  await writeFile(
    join(root, "packages", "payer", "package.json"),
    JSON.stringify({ name: "vellar-mcp-x402-payer", engines: { node: payerRange } }),
  );
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Node.js support matrix", () => {
  it("accepts one minimum across the SDK, CLI, and MCP payer", async () => {
    const report = await auditNodeEngines(await fixture(">=20"));
    expect(report.violations).toEqual([]);
    expect(report.oldest).toBe(20);
    expect(report.packages.map(({ name }) => name).sort()).toEqual([
      "vellar-cli",
      "vellar-mcp-x402-payer",
    ]);
  });

  it("reports the root package when engines.node is absent", async () => {
    const report = await auditNodeEngines(await fixture());
    expect(report.violations).toContain("vellar-sdk does not declare engines.node");
  });

  it("reports a workspace range that drifts from the root", async () => {
    const report = await auditNodeEngines(await fixture(">=20", ">=22"));
    expect(report.violations).toContain("vellar-cli declares >=22; expected >=20");
  });

  it("rejects a range whose oldest CI version cannot be derived", () => {
    expect(oldestSupportedNode("latest")).toBeUndefined();
    expect(oldestSupportedNode(">=20")).toBe(20);
  });
});
