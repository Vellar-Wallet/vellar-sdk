import { describe, expect, it } from "vitest";
import {
  createSmokePlan,
  evaluateInstallResult,
  evaluateSmokeResult,
  validatePackedFiles,
} from "./standalone-install.mjs";

describe("standalone workspace install harness", () => {
  it("builds the CLI help smoke plan", () => {
    expect(createSmokePlan({ name: "vellar-cli", bin: { vellar: "dist/bin.js" } })).toEqual({
      entry: "dist/bin.js",
      args: ["--help"],
      expectedExitCode: 0,
      stderrPattern: null,
    });
  });

  it("builds the MCP startup-guard smoke plan", () => {
    expect(createSmokePlan({
      name: "vellar-mcp-x402-payer",
      bin: { "vellar-mcp-x402-payer": "dist/bin.js" },
    })).toMatchObject({
      entry: "dist/bin.js",
      expectedExitCode: 1,
      stderrPattern: /failed to start/i,
    });
  });

  it("fails when npm pack omitted a runtime entry", () => {
    const result = validatePackedFiles(
      { name: "vellar-cli", main: "./dist/index.js", bin: { vellar: "dist/bin.js" } },
      [{ path: "dist/index.js" }],
    );
    expect(result).toEqual({ valid: false, missing: ["dist/bin.js"] });
  });

  it("recognizes an isolated install dependency-resolution failure", () => {
    expect(evaluateInstallResult({
      status: 1,
      stdout: "",
      stderr: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'hidden-root-dependency'",
    })).toEqual({
      valid: false,
      reason: "isolated install exposed an undeclared or unresolved runtime dependency",
    });
  });

  it("accepts CLI help and the MCP configuration guard as smoke success", () => {
    expect(evaluateSmokeResult(
      { status: 0, stdout: "Usage: vellar", stderr: "" },
      createSmokePlan({ name: "vellar-cli", bin: { vellar: "dist/bin.js" } }),
    ).valid).toBe(true);

    expect(evaluateSmokeResult(
      { status: 1, stdout: "", stderr: "vellar-mcp-x402-payer failed to start: missing secret" },
      createSmokePlan({
        name: "vellar-mcp-x402-payer",
        bin: { "vellar-mcp-x402-payer": "dist/bin.js" },
      }),
    ).valid).toBe(true);
  });

  it("rejects a smoke failure before the expected MCP configuration guard", () => {
    const result = evaluateSmokeResult(
      { status: 1, stdout: "", stderr: "Error: unexpected startup failure" },
      createSmokePlan({
        name: "vellar-mcp-x402-payer",
        bin: { "vellar-mcp-x402-payer": "dist/bin.js" },
      }),
    );
    expect(result).toEqual({
      valid: false,
      reason: "startup failure did not reach the expected configuration guard",
    });
  });

  it("rejects unsupported packages instead of silently skipping smoke coverage", () => {
    expect(() => createSmokePlan({ name: "unknown-package" })).toThrow(
      "No standalone smoke command",
    );
  });
});
