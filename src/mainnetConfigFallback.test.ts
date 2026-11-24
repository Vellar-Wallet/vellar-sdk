import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MAINNET, MainnetConfigError, TESTNET, mainnetConfig } from "./config";

const VALID_HASH = "a".repeat(64);
const RPC = "https://rpc.example.com";

type Opts = Parameters<typeof mainnetConfig>[0];

/**
 * Extract a top-level function's body by balancing braces. The parameter type
 * literal also has braces, so take the first balanced span that contains a
 * `return` statement.
 */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}`);
  if (start < 0) throw new Error(`${name} not found in config.ts`);

  for (let open = source.indexOf("{", start); open >= 0; open = source.indexOf("{", open + 1)) {
    let depth = 0;
    for (let index = open; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          const candidate = source.slice(start, index + 1);
          if (candidate.includes("return ")) return candidate;
          break;
        }
      }
    }
  }
  throw new Error(`Unbalanced braces in ${name}`);
}

describe("#859 — mainnetConfig never falls back to the testnet hash", () => {
  it("throws when walletWasmHash is omitted instead of returning a config", () => {
    expect(() => mainnetConfig({ rpcUrl: RPC } as Opts)).toThrow(MainnetConfigError);
    expect(() => mainnetConfig({} as Opts)).toThrow(MainnetConfigError);
    expect(() => mainnetConfig({ rpcUrl: RPC, walletWasmHash: undefined as unknown as string })).toThrow(
      MainnetConfigError,
    );
  });

  it("never produces the TESTNET walletWasmHash from a blank input", () => {
    let result: ReturnType<typeof mainnetConfig> | undefined;
    try {
      result = mainnetConfig({ rpcUrl: RPC, walletWasmHash: "" });
    } catch (error) {
      expect(error).toBeInstanceOf(MainnetConfigError);
    }

    expect(result).toBeUndefined();
    expect(result?.walletWasmHash).not.toBe(TESTNET.walletWasmHash);
  });

  it("uses the caller's hash verbatim rather than a shipped default", () => {
    const hash = "b".repeat(64);
    expect(hash).not.toBe(TESTNET.walletWasmHash);
    expect(mainnetConfig({ rpcUrl: RPC, walletWasmHash: hash }).walletWasmHash).toBe(hash);
  });

  it("does not fall back on whitespace-only input", () => {
    expect(() => mainnetConfig({ rpcUrl: RPC, walletWasmHash: "   " })).toThrow(
      MainnetConfigError,
    );
  });

  it("statically confirms mainnetConfig has no TESTNET reference in its body", () => {
    const source = readFileSync(new URL("./config.ts", import.meta.url), "utf8");
    const body = functionBody(source, "mainnetConfig");

    expect(body).toContain("return { ...MAINNET");
    expect(body).not.toMatch(/TESTNET/);
    expect(body).not.toMatch(/walletWasmHash[^\n]*\?\?/);
  });

  it("keeps the exported MAINNET hash blank so no default can be copied", () => {
    expect(MAINNET.walletWasmHash).toBe("");
  });
});
