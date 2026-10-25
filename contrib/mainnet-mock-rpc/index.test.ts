// Unit & integration tests for the local-testing-only mainnetConfig + mock RPC example (#633).

import { Networks } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { MAINNET, MainnetConfigError, TESTNET, mainnetConfig } from "../../src/config";
import {
  LOCAL_TEST_ONLY_MAINNET_WASM_HASH,
  runMainnetMockRpcExample,
  startMockMainnetRpcServer,
  validateMainnetNetworkConfig,
} from "./index";

describe("contrib/mainnet-mock-rpc — mainnetConfig with local mock RPC (#633)", () => {
  it("runs the example end-to-end against the local mock RPC and constructs a valid mainnet NetworkConfig", async () => {
    const logs: string[] = [];
    const report = await runMainnetMockRpcExample({
      log: (line) => logs.push(line),
    });

    expect(report.valid).toBe(true);
    expect(report.localTestingOnly).toBe(true);
    expect(report.config.network).toBe("mainnet");
    expect(report.config.networkPassphrase).toBe(Networks.PUBLIC);
    expect(report.config.horizonUrl).toBe(MAINNET.horizonUrl);
    expect(report.config.nativeTokenContractId).toBe(MAINNET.nativeTokenContractId);
    expect(report.config.usdcIssuer).toBe(MAINNET.usdcIssuer);
    expect(report.config.usdcContractId).toBe(MAINNET.usdcContractId);
    expect(report.config.walletWasmHash).toBe(LOCAL_TEST_ONLY_MAINNET_WASM_HASH);
    expect(report.config.rpcUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(report.rpcNetworkPassphrase).toBe(Networks.PUBLIC);
    expect(report.rpcLatestLedger).toBe(55_000_000);
    expect(logs.some((l) => l.includes("LOCAL-TESTING-ONLY"))).toBe(true);
  });

  it("normalizes uppercase hex hashes and trims rpcUrl in mainnetConfig", async () => {
    const server = await startMockMainnetRpcServer();
    try {
      const cfg = mainnetConfig({
        rpcUrl: `  ${server.rpcUrl}  `,
        walletWasmHash: LOCAL_TEST_ONLY_MAINNET_WASM_HASH.toUpperCase(),
      });
      expect(cfg.rpcUrl).toBe(server.rpcUrl);
      expect(cfg.walletWasmHash).toBe(LOCAL_TEST_ONLY_MAINNET_WASM_HASH);

      const validation = validateMainnetNetworkConfig(cfg);
      expect(validation.derivedNativeSacId).toBe(MAINNET.nativeTokenContractId);
      expect(validation.derivedUsdcSacId).toBe(MAINNET.usdcContractId);
    } finally {
      await server.close();
    }
  });

  it("rejects missing rpcUrl or malformed walletWasmHash with MainnetConfigError", () => {
    expect(() =>
      mainnetConfig({
        rpcUrl: "   ",
        walletWasmHash: LOCAL_TEST_ONLY_MAINNET_WASM_HASH,
      }),
    ).toThrow(MainnetConfigError);

    expect(() =>
      mainnetConfig({
        rpcUrl: "http://127.0.0.1:8545",
        walletWasmHash: "not-a-64-char-hex-hash",
      }),
    ).toThrow(MainnetConfigError);
  });

  it("rejects accidentally reusing TESTNET.walletWasmHash in validateMainnetNetworkConfig", () => {
    const cfgWithTestnetHash = mainnetConfig({
      rpcUrl: "http://127.0.0.1:8545",
      walletWasmHash: TESTNET.walletWasmHash,
    });

    expect(() => validateMainnetNetworkConfig(cfgWithTestnetHash)).toThrow(MainnetConfigError);
    expect(() => validateMainnetNetworkConfig(cfgWithTestnetHash)).toThrow(
      /must not reuse TESTNET\.walletWasmHash/,
    );
  });

  it("rejects tampered SAC contract IDs or impostor USDC issuers", () => {
    const baseCfg = mainnetConfig({
      rpcUrl: "http://127.0.0.1:8545",
      walletWasmHash: LOCAL_TEST_ONLY_MAINNET_WASM_HASH,
    });

    expect(() =>
      validateMainnetNetworkConfig({
        ...baseCfg,
        nativeTokenContractId: TESTNET.nativeTokenContractId,
      }),
    ).toThrow(MainnetConfigError);

    expect(() =>
      validateMainnetNetworkConfig({
        ...baseCfg,
        usdcIssuer: TESTNET.usdcIssuer,
      }),
    ).toThrow(MainnetConfigError);

    expect(() =>
      validateMainnetNetworkConfig({
        ...baseCfg,
        usdcContractId: TESTNET.usdcContractId,
      }),
    ).toThrow(MainnetConfigError);
  });

  it("rejects when the mock RPC server reports a non-mainnet network passphrase", async () => {
    await expect(
      runMainnetMockRpcExample({
        mockRpcOptions: {
          networkPassphrase: TESTNET.networkPassphrase,
        },
        log: () => {},
      }),
    ).rejects.toThrow(MainnetConfigError);
  });

  it("rejects when the mock RPC server reports an unhealthy status", async () => {
    await expect(
      runMainnetMockRpcExample({
        mockRpcOptions: {
          healthStatus: "unhealthy",
        },
        log: () => {},
      }),
    ).rejects.toThrow(/unhealthy status/);
  });
});
