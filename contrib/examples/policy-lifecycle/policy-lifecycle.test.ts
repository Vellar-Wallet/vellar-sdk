import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPolicyLifecycle } from "./policy-lifecycle";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("framework-free policy lifecycle example", () => {
  it("calls listTemplates, generate, simulate, and deploy through the public facade", async () => {
    const log = vi.fn();
    const result = await runPolicyLifecycle(log);

    expect(result).toMatchObject({
      templateCount: 1,
      simulationOk: true,
      contractId: "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND",
    });
    expect(result.attachTxHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.requestPaths).toEqual([
      "/policies/templates",
      "/policies/generate",
      `/policies/${result.policyId}/simulate`,
      `/policies/${result.policyId}/deploy-instance`,
      "/policies/deploy",
    ]);
    expect(log.mock.calls.map(([message]) => message)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^listTemplates:/),
        expect.stringMatching(/^generate:/),
        expect.stringMatching(/^simulate:/),
        expect.stringMatching(/^deploy:/),
      ]),
    );
  });

  it("bundles and exits zero as a standalone Node process", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "vellar-policy-example-"));
    temporaryDirectories.push(outputDirectory);
    const output = join(outputDirectory, "policy-lifecycle.mjs");
    await build({
      entryPoints: [resolve("contrib/examples/policy-lifecycle/policy-lifecycle.ts")],
      outfile: output,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
    });

    const execution = await execFileAsync(process.execPath, [output]);
    expect(execution.stderr).toBe("");
    expect(execution.stdout).toContain("listTemplates: 1 template(s)");
    expect(execution.stdout).toContain("complete: policy-1");
  });
});
