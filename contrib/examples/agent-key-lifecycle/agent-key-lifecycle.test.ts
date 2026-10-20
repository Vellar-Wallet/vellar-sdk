import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgentKeyLifecycle } from "./agent-key-lifecycle";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("agent-key mint and revoke example", () => {
  it("mints both policy grants, signs, revokes, and refuses another signature", async () => {
    const log = vi.fn();
    const result = await runAgentKeyLifecycle(log);

    expect(result.mintHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.revokeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.signatureBeforeRevoke).toMatch(/^signed:/);
    expect(result.signingRejectedAfterRevoke).toBe(true);
    expect(result.grants[0]?.policies).toHaveLength(2);
    expect(log).toHaveBeenCalledWith("sign after revoke: rejected");
  });

  it("runs end to end as a standalone Node process", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "vellar-agent-key-example-"));
    temporaryDirectories.push(outputDirectory);
    const output = join(outputDirectory, "agent-key-lifecycle.mjs");
    await build({
      entryPoints: [resolve("contrib/examples/agent-key-lifecycle/agent-key-lifecycle.ts")],
      outfile: output,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
    });

    const execution = await execFileAsync(process.execPath, [output]);
    expect(execution.stderr).toBe("");
    expect(execution.stdout).toContain("sign before revoke: signed:");
    expect(execution.stdout).toContain("sign after revoke: rejected");
    expect(execution.stdout).toContain("complete: agent key cannot sign after revoke");
  });
});
