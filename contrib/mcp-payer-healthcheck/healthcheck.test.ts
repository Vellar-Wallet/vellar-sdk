/**
 * REFERENCE TEST IMPLEMENTATION for issue #679.
 * Copy/adapt into packages/mcp-x402-payer/src/healthcheck.test.ts alongside
 * healthcheck.ts.
 */

import { describe, expect, it } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import {
  checkMcpPayerHealth,
  HEALTHCHECK_EXIT_CODE,
} from "./healthcheck";

/**
 * Writes a tiny standalone Node script that behaves like one of the three
 * target scenarios, so the test exercises the real spawn/stdio path rather
 * than mocking child_process.
 */
function writeFixtureScript(name: string, source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-healthcheck-fixture-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, source, "utf8");
  return file;
}

const HEALTHY_SERVER = `
process.stdin.on("data", (chunk) => {
  const req = JSON.parse(chunk.toString("utf8").trim());
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { tools: [] } }) + "\\n");
});
`;

const UNRESPONSIVE_SERVER = `
// Never responds to stdin at all; just hangs, like a deadlocked process.
process.stdin.resume();
`;

const ERROR_RESPONSE_SERVER = `
process.stdin.on("data", (chunk) => {
  const req = JSON.parse(chunk.toString("utf8").trim());
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "boom" } }) + "\\n");
});
`;

const CRASHES_IMMEDIATELY_SCRIPT = `
process.exit(7);
`;

describe("checkMcpPayerHealth (#679)", () => {
  it("reports healthy when the process answers tools/list in time", async () => {
    const script = writeFixtureScript("healthy.js", HEALTHY_SERVER);
    const result = await checkMcpPayerHealth({
      command: process.execPath,
      args: [script],
      timeoutMs: 2000,
    });

    expect(result.code).toBe(HEALTHCHECK_EXIT_CODE.HEALTHY);
  });

  it("reports unresponsive when the process never answers within the timeout", async () => {
    const script = writeFixtureScript("unresponsive.js", UNRESPONSIVE_SERVER);
    const result = await checkMcpPayerHealth({
      command: process.execPath,
      args: [script],
      timeoutMs: 300,
    });

    expect(result.code).toBe(HEALTHCHECK_EXIT_CODE.UNRESPONSIVE);
  });

  it("reports unresponsive (not not-running) when the process answers with a JSON-RPC error", async () => {
    const script = writeFixtureScript("error-response.js", ERROR_RESPONSE_SERVER);
    const result = await checkMcpPayerHealth({
      command: process.execPath,
      args: [script],
      timeoutMs: 2000,
    });

    expect(result.code).toBe(HEALTHCHECK_EXIT_CODE.UNRESPONSIVE);
  });

  it("reports not-running when the process exits before answering", async () => {
    const script = writeFixtureScript("crashes.js", CRASHES_IMMEDIATELY_SCRIPT);
    const result = await checkMcpPayerHealth({
      command: process.execPath,
      args: [script],
      timeoutMs: 2000,
    });

    expect(result.code).toBe(HEALTHCHECK_EXIT_CODE.NOT_RUNNING);
  });

  it("reports not-running when the command itself cannot be spawned", async () => {
    const result = await checkMcpPayerHealth({
      command: "/no/such/binary/exists-xyz",
      args: [],
      timeoutMs: 1000,
    });

    expect(result.code).toBe(HEALTHCHECK_EXIT_CODE.NOT_RUNNING);
  });

  it("the three exit codes are distinct", () => {
    const codes = new Set([
      HEALTHCHECK_EXIT_CODE.HEALTHY,
      HEALTHCHECK_EXIT_CODE.UNRESPONSIVE,
      HEALTHCHECK_EXIT_CODE.NOT_RUNNING,
    ]);
    expect(codes.size).toBe(3);
  });
});
