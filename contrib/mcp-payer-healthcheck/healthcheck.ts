/**
 * REFERENCE IMPLEMENTATION for issue #679.
 * Copy/adapt this into packages/mcp-x402-payer/src/healthcheck.ts and wire
 * it up as a `vellar-mcp-x402-payer-healthcheck` bin entry, see this
 * folder's README.md for the exact integration steps.
 *
 * Standalone health-check for a running (or about-to-run) MCP payer process.
 * Spawns the payer binary, speaks one JSON-RPC `tools/list` request over its
 * stdio transport, and exits with a distinct code depending on outcome:
 *
 *   0  healthy      — process started and answered tools/list in time
 *   1  unresponsive — process started but did not answer in time, or
 *                      answered with a malformed/error response
 *   2  not-running   — the process could not be spawned at all (missing
 *                      binary, non-zero spawn-time exit, etc.)
 *
 * These three codes are intentionally distinct so a process supervisor can
 * tell "needs a restart" (1) apart from "binary/config is broken" (2),
 * rather than collapsing both into a single non-zero failure.
 */

import { spawn } from "node:child_process";

export const HEALTHCHECK_EXIT_CODE = {
  HEALTHY: 0,
  UNRESPONSIVE: 1,
  NOT_RUNNING: 2,
} as const;

export type HealthcheckExitCode =
  (typeof HEALTHCHECK_EXIT_CODE)[keyof typeof HEALTHCHECK_EXIT_CODE];

export interface HealthcheckResult {
  code: HealthcheckExitCode;
  message: string;
  /** Wall-clock time from spawn to result, in milliseconds. */
  elapsedMs: number;
}

export interface HealthcheckOptions {
  /** Command to run the MCP payer binary. @default "node" */
  command?: string;
  /** Arguments passed to `command`. @default ["dist/bin.js"] */
  args?: string[];
  /** Environment variables for the spawned process. Merged over `process.env`. */
  env?: Record<string, string>;
  /** Milliseconds to wait for a tools/list response before declaring the process unresponsive. @default 5000 */
  timeoutMs?: number;
  /** Working directory for the spawned process. */
  cwd?: string;
}

const DEFAULT_TIMEOUT_MS = 5000;
const TOOLS_LIST_REQUEST_ID = "healthcheck-tools-list";

function buildToolsListRequest(): string {
  return (
    JSON.stringify({
      jsonrpc: "2.0",
      id: TOOLS_LIST_REQUEST_ID,
      method: "tools/list",
      params: {},
    }) + "\n"
  );
}

/**
 * MCP over stdio is newline-delimited JSON-RPC. A single stdout chunk may
 * contain a partial message, multiple messages, or framing from an
 * unrelated log line that isn't valid JSON at all (the server is expected
 * to keep non-protocol output on stderr, but a health check must not crash
 * if that invariant is ever violated by a future change).
 */
function tryParseJsonRpcResponse(
  buffer: string,
  expectedId: string,
): { matched: boolean; isError: boolean } | undefined {
  for (const line of buffer.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as {
        id?: string;
        result?: unknown;
        error?: unknown;
      };
      if (parsed.id === expectedId) {
        return { matched: true, isError: parsed.error !== undefined };
      }
    } catch {
      // Not a JSON line (e.g. stray log output) — ignore and keep scanning.
    }
  }
  return undefined;
}

/**
 * Spawn the MCP payer process, send one `tools/list` request, and resolve
 * once it either answers, times out, or the process exits/errors before
 * answering.
 */
export function checkMcpPayerHealth(
  options: HealthcheckOptions = {},
): Promise<HealthcheckResult> {
  const command = options.command ?? "node";
  const args = options.args ?? ["dist/bin.js"];
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    let stdoutBuffer = "";

    const settle = (code: HealthcheckExitCode, message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      child.kill();
      resolve({ code, message, elapsedMs: Date.now() - startedAt });
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        code: HEALTHCHECK_EXIT_CODE.NOT_RUNNING,
        message: `Failed to spawn MCP payer process: ${error instanceof Error ? error.message : String(error)}`,
        elapsedMs: Date.now() - startedAt,
      });
      return;
    }

    const timeoutTimer = setTimeout(() => {
      settle(
        HEALTHCHECK_EXIT_CODE.UNRESPONSIVE,
        `MCP payer process did not respond to tools/list within ${timeoutMs}ms.`,
      );
    }, timeoutMs);

    child.once("error", (error) => {
      settle(
        HEALTHCHECK_EXIT_CODE.NOT_RUNNING,
        `MCP payer process could not be started: ${error.message}`,
      );
    });

    child.once("exit", (exitCode, signal) => {
      if (settled) return;
      settle(
        HEALTHCHECK_EXIT_CODE.NOT_RUNNING,
        `MCP payer process exited before responding (code=${exitCode}, signal=${signal}).`,
      );
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      if (settled) return;
      stdoutBuffer += chunk.toString("utf8");
      const parsed = tryParseJsonRpcResponse(stdoutBuffer, TOOLS_LIST_REQUEST_ID);
      if (!parsed) return;
      if (parsed.isError) {
        settle(
          HEALTHCHECK_EXIT_CODE.UNRESPONSIVE,
          "MCP payer process responded to tools/list with a JSON-RPC error.",
        );
      } else {
        settle(HEALTHCHECK_EXIT_CODE.HEALTHY, "MCP payer process is healthy.");
      }
    });

    child.stdin?.write(buildToolsListRequest());
  });
}

/** CLI entrypoint: `node healthcheck.js [-- command args...]`. */
export async function runHealthcheckCli(argv: string[] = process.argv.slice(2)): Promise<never> {
  const separatorIndex = argv.indexOf("--");
  const [command, ...args] =
    separatorIndex >= 0 ? argv.slice(separatorIndex + 1) : [];

  const result = await checkMcpPayerHealth(
    command ? { command, args } : {},
  );
  console.log(`[mcp-payer-healthcheck] ${result.message} (${result.elapsedMs}ms)`);
  process.exit(result.code);
}
