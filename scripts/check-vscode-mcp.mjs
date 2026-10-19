#!/usr/bin/env node
// Extract the VS Code MCP config snippet from vscode.md and check every env
// var and payer CLI flag in it against packages/mcp-x402-payer. A renamed or
// removed flag fails CI instead of failing the next person who copies the doc.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DOC = "website/content/docs/agent-tooling/vscode.md";
export const CONFIG_SRC = "packages/mcp-x402-payer/src/config.ts";
export const BIN_SRC = "packages/mcp-x402-payer/src/bin.ts";

/** Package/binary tokens. Flags after one of these belong to the payer. */
const PAYER_TOKENS = ["vellar-mcp-x402-payer", "dist/bin.js", "bin.js"];

export function acceptedEnvVars(configSource) {
  const names = new Set();
  for (const match of configSource.matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)) names.add(match[1]);
  for (const match of configSource.matchAll(/required\(\s*env\s*,\s*"([A-Z][A-Z0-9_]*)"\s*\)/g)) {
    names.add(match[1]);
  }
  return names;
}

export function acceptedCliFlags(binSource) {
  const flags = new Set();
  for (const match of binSource.matchAll(/["'](--[a-zA-Z0-9][\w-]*)["']/g)) flags.add(match[1]);
  return flags;
}

function stripJsonc(source) {
  const withoutLineComments = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  return withoutLineComments.replace(/,(\s*[}\]])/g, "$1");
}

export function extractMcpSnippets(markdown) {
  const blocks = [...markdown.matchAll(/```jsonc?\n([\s\S]*?)```/g)].map((m) => m[1]);
  const snippets = [];
  for (const block of blocks) {
    let parsed;
    try {
      parsed = JSON.parse(stripJsonc(block));
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    if ("mcpServers" in parsed || "servers" in parsed || "env" in parsed) snippets.push(parsed);
  }
  return snippets;
}

function serverEntries(snippet) {
  const groups = [snippet.mcpServers, snippet.servers].filter(
    (g) => g && typeof g === "object" && !Array.isArray(g),
  );
  const servers = [];
  for (const group of groups) {
    for (const value of Object.values(group)) {
      if (value && typeof value === "object") servers.push(value);
    }
  }
  if (groups.length === 0 && snippet.env) servers.push(snippet);
  return servers;
}

function payerFlags(args) {
  if (!Array.isArray(args)) return [];
  const idx = args.findIndex(
    (arg) => typeof arg === "string" && PAYER_TOKENS.some((token) => arg === token || arg.endsWith(`/${token}`)),
  );
  const rest = idx === -1 ? args : args.slice(idx + 1);
  return rest.filter((arg) => typeof arg === "string" && arg.startsWith("-"));
}

/**
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateSnippets(snippets, envVars, cliFlags) {
  const errors = [];
  if (snippets.length === 0) {
    return { ok: false, errors: ["no VS Code MCP config JSON snippet found"] };
  }

  for (const snippet of snippets) {
    for (const server of serverEntries(snippet)) {
      const env = server.env;
      if (env && typeof env === "object" && !Array.isArray(env)) {
        for (const name of Object.keys(env)) {
          if (!envVars.has(name)) {
            errors.push(`env var ${name} is not accepted by config.ts or bin.ts`);
          }
        }
      }
      for (const flag of payerFlags(server.args)) {
        const normalized = flag.includes("=") ? flag.slice(0, flag.indexOf("=")) : flag;
        if (!cliFlags.has(normalized)) {
          errors.push(`CLI flag ${normalized} is not accepted by bin.ts`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export function checkSources({ markdown, configSource, binSource }) {
  return validateSnippets(
    extractMcpSnippets(markdown),
    acceptedEnvVars(configSource),
    acceptedCliFlags(binSource),
  );
}

function main() {
  const result = checkSources({
    markdown: readFileSync(path.join(root, DOC), "utf8"),
    configSource: readFileSync(path.join(root, CONFIG_SRC), "utf8"),
    binSource: readFileSync(path.join(root, BIN_SRC), "utf8"),
  });
  if (!result.ok) {
    console.error(`VS Code MCP config in ${DOC} does not match the payer:`);
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`VS Code MCP config in ${DOC} matches the payer config schema`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
