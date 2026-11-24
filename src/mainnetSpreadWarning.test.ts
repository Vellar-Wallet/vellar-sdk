import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVellarWallet } from "./client";
import { MAINNET, TESTNET, mainnetConfig, warnIfMainnetSpread } from "./config";

const HASH = "a".repeat(64);
const RPC = "https://rpc.example.com";

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

/** Minimal host-supplied fakes — no network calls happen at construction. */
function walletConfig(overrides: Record<string, unknown> = {}) {
  return {
    appName: "Test App",
    kit: {} as never,
    backend: {} as never,
    sac: {} as never,
    isValidAddress: () => true,
    ...overrides,
  };
}

describe("#861 — warn when MAINNET is spread with blank fields", () => {
  it("warns for a bare MAINNET spread and names mainnetConfig as the fix", () => {
    expect(warnIfMainnetSpread({ ...MAINNET }, "createVellarWallet")).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain("MAINNET was spread directly");
    expect(message).toContain("mainnetConfig(");
    expect(message).toContain("rpcUrl and walletWasmHash");
  });

  it("warns when only one of the two fields is left blank", () => {
    expect(warnIfMainnetSpread({ ...MAINNET, rpcUrl: RPC })).toBe(true);
    expect(String(warn.mock.calls[0]?.[0])).toContain("walletWasmHash");

    warn.mockClear();

    expect(warnIfMainnetSpread({ ...MAINNET, walletWasmHash: HASH })).toBe(true);
    expect(String(warn.mock.calls[0]?.[0])).toContain("blank rpcUrl");
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("blank walletWasmHash");
  });

  it("stays quiet for mainnetConfig results, testnet, and unrelated configs", () => {
    expect(warnIfMainnetSpread(mainnetConfig({ rpcUrl: RPC, walletWasmHash: HASH }))).toBe(false);
    expect(warnIfMainnetSpread(TESTNET)).toBe(false);
    expect(warnIfMainnetSpread({ rpcUrl: "", walletWasmHash: "" })).toBe(false);
    expect(warnIfMainnetSpread({ network: "mainnet", rpcUrl: RPC, walletWasmHash: HASH })).toBe(
      false,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("triggers through createVellarWallet when MAINNET is spread directly", () => {
    createVellarWallet(walletConfig({ ...MAINNET }));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("mainnetConfig(");
  });

  it("does not warn through createVellarWallet for a configured mainnet config", () => {
    createVellarWallet(walletConfig(mainnetConfig({ rpcUrl: RPC, walletWasmHash: HASH })));
    expect(warn).not.toHaveBeenCalled();
  });

  it("accepts an RPC supplied only under x402 without a false warning", () => {
    createVellarWallet(
      walletConfig({
        network: "mainnet",
        walletWasmHash: HASH,
        x402: { rpcUrl: RPC },
      }),
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
