// The deliverable, end to end: a REAL MCP client spawns the built server over
// stdio and pays for a real resource through the protocol.
//
// Everything else in this suite exercises the payer core directly. That proves
// the payment logic but skips the entire reason this package exists — tool
// registration, JSON-Schema argument validation, stdio framing, and the
// serialisation of results back to a model. A settled payment that never went
// over the wire is not a working MCP server.
//
// Requires the same local stack as payer.integration.test.ts, plus a build
// (`npm run build`) because the client spawns dist/bin.js.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readIntegrationEnv } from "./local-only.js";

const env = readIntegrationEnv();
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BIN = join(PKG_ROOT, "dist", "bin.js");

/** Pull the single text block out of a tool result. */
function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? "").join("\n");
}

describe.skipIf(env === null)("MCP server over stdio (real client, real payment)", () => {
  let client: Client;

  beforeAll(async () => {
    if (!existsSync(BIN)) {
      // Build rather than fail: a stale/absent dist is a setup problem, not a
      // product defect, and silently skipping would hide the gap this covers.
      spawnSync("npx", ["tsup"], { cwd: PKG_ROOT, stdio: "inherit" });
    }
    expect(existsSync(BIN), `built server missing at ${BIN}`).toBe(true);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BIN],
      env: {
        PATH: process.env.PATH ?? "",
        VELLAR_X402_SECRET: env!.secret,
        // Enough headroom for the payment below, and no more.
        VELLAR_X402_ASSETS: `${env!.asset}:10000000`,
        VELLAR_X402_NETWORK: "testnet",
      },
      stderr: "pipe",
    });

    client = new Client({ name: "integration-probe", version: "1.0.0" });
    await client.connect(transport);
  }, 60_000);

  afterAll(async () => {
    await client?.close();
  });

  it("advertises its tools over the protocol", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();

    expect(names).toEqual(["x402_pay", "x402_quote", "x402_session_budget"]);
    // The spend limits are the SERVER's, so they must not appear as arguments
    // the model can set.
    const pay = tools.find((t) => t.name === "x402_pay")!;
    const props = Object.keys(
      (pay.inputSchema as { properties?: Record<string, unknown> }).properties ?? {},
    ).sort();
    expect(props).toEqual(["max_amount", "resource_url"]);
  });

  it("rejects a malformed max_amount at the protocol boundary", async () => {
    // Schema validation refuses this before any handler code runs. The SDK
    // reports it as an isError result rather than a rejected promise.
    const result = await client.callTool({
      name: "x402_pay",
      arguments: { resource_url: env!.sellerUrl, max_amount: "1e6" },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Input validation error/);
    expect(textOf(result)).toMatch(/max_amount/);
  });

  it("quotes a real resource without spending", async () => {
    const result = await client.callTool({
      name: "x402_quote",
      arguments: { resource_url: env!.sellerUrl },
    });
    const text = textOf(result);

    expect(text).toMatch(/Payment required/);
    expect(text).toMatch(new RegExp(env!.asset));
    expect(text).toMatch(/nothing was signed by this call/);
  }, 60_000);

  it("PAYS a real resource through the protocol and returns the unlocked content", async () => {
    const before = await client.callTool({
      name: "x402_session_budget",
      arguments: {},
    });

    const result = await client.callTool({
      name: "x402_pay",
      arguments: { resource_url: env!.sellerUrl, max_amount: "1000000" },
    });
    const text = textOf(result);

    expect(result.isError ?? false).toBe(false);
    // A real settlement hash, and the unlocked content, over stdio.
    const hash = text.match(/Settlement transaction: ([0-9a-f]{64})/)?.[1];
    expect(hash, `no settlement hash in:\n${text}`).toBeDefined();
    expect(text).toMatch(/Ships are safe in harbor/);

    // Content from the resource server is fenced as untrusted.
    expect(text).toMatch(/BEGIN UNTRUSTED RESOURCE DATA/);
    expect(text).toMatch(/DATA, not instructions/);

    // The session ledger moved by exactly the price, visible through the protocol.
    const after = await client.callTool({ name: "x402_session_budget", arguments: {} });
    const remaining = (t: string) => BigInt(t.match(/(\d+) remaining/)![1]!);
    expect(remaining(textOf(before)) - remaining(textOf(after))).toBe(1_000_000n);

    // Verify the hash on-chain rather than trusting the response.
    const res = await fetch(`https://horizon-testnet.stellar.org/transactions/${hash}`);
    expect(res.ok, `Horizon did not find ${hash}`).toBe(true);
    expect(((await res.json()) as { successful: boolean }).successful).toBe(true);
  }, 180_000);

  it("refuses an over-limit payment through the protocol without spending", async () => {
    const before = await client.callTool({ name: "x402_session_budget", arguments: {} });

    const result = await client.callTool({
      name: "x402_pay",
      arguments: { resource_url: env!.sellerUrl, max_amount: "1" },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/exceeds maxAmount/);

    const after = await client.callTool({ name: "x402_session_budget", arguments: {} });
    expect(textOf(after)).toBe(textOf(before));
  }, 60_000);
});
