import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BIN_SRC,
  CONFIG_SRC,
  acceptedCliFlags,
  acceptedEnvVars,
  checkSources,
} from "./check-vscode-mcp.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CONFIG = `
function load(env) {
  const secret = env.VELLAR_X402_SECRET?.trim();
  const file = env.VELLAR_X402_SECRET_FILE?.trim();
  const assets = required(env, "VELLAR_X402_ASSETS");
  const network = env.VELLAR_X402_NETWORK;
  return { secret, file, assets, network };
}
`;

const BIN = `
async function main() {
  const config = loadConfig();
  await startStdio(config);
}
`;

const FRESH = `
\`\`\`json
{
  "servers": {
    "vellar-x402-payer": {
      "command": "npx",
      "args": ["-y", "vellar-mcp-x402-payer"],
      "env": {
        "VELLAR_X402_SECRET_FILE": "/run/secrets/x402-payer-key",
        "VELLAR_X402_ASSETS": "C:1",
        "VELLAR_X402_NETWORK": "testnet"
      }
    }
  }
}
\`\`\`
`;

describe("check-vscode-mcp", () => {
  it("accepts a snippet whose env vars the config source reads", () => {
    const result = checkSources({ markdown: FRESH, configSource: CONFIG, binSource: BIN });
    expect(result).toEqual({ ok: true, errors: [] });
  });

  it("ignores launcher flags that appear before the payer package name", () => {
    const result = checkSources({ markdown: FRESH, configSource: CONFIG, binSource: BIN });
    expect(result.errors.join("\n")).not.toMatch(/-y/);
  });

  it("fails when the snippet names an env var the payer no longer reads", () => {
    const stale = FRESH.replace(
      "VELLAR_X402_NETWORK",
      "VELLAR_X402_OLD_NETWORK",
    );
    const result = checkSources({ markdown: stale, configSource: CONFIG, binSource: BIN });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "env var VELLAR_X402_OLD_NETWORK is not accepted by config.ts or bin.ts",
    );
  });

  it("fails when a fixture snippet passes a flag bin.ts does not accept", () => {
    const stale = FRESH.replace(
      '"args": ["-y", "vellar-mcp-x402-payer"]',
      '"args": ["-y", "vellar-mcp-x402-payer", "--old-rpc"]',
    );
    const result = checkSources({ markdown: stale, configSource: CONFIG, binSource: BIN });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("CLI flag --old-rpc is not accepted by bin.ts");
  });

  it("accepts a flag that bin.ts actually parses", () => {
    const withFlag = FRESH.replace(
      '"args": ["-y", "vellar-mcp-x402-payer"]',
      '"args": ["-y", "vellar-mcp-x402-payer", "--network", "testnet"]',
    );
    const bin = `${BIN}\nconst flag = "--network";\n`;
    const result = checkSources({ markdown: withFlag, configSource: CONFIG, binSource: bin });
    expect(result.ok).toBe(true);
    expect(acceptedCliFlags(bin).has("--network")).toBe(true);
  });

  it("fails when the doc has no MCP config snippet", () => {
    const result = checkSources({
      markdown: "# VS Code\n\nNo config here.\n",
      configSource: CONFIG,
      binSource: BIN,
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("no VS Code MCP config JSON snippet found");
  });

  it("parses the env vars the real payer config accepts, and no CLI flags from bin.ts", () => {
    const env = acceptedEnvVars(readFileSync(path.join(root, CONFIG_SRC), "utf8"));
    expect(env.has("VELLAR_X402_ASSETS")).toBe(true);
    expect(env.has("VELLAR_X402_SECRET")).toBe(true);
    expect(env.has("VELLAR_X402_SECRET_FILE")).toBe(true);
    expect(env.has("VELLAR_X402_NETWORK")).toBe(true);
    expect(acceptedCliFlags(readFileSync(path.join(root, BIN_SRC), "utf8")).size).toBe(0);
  });
});
