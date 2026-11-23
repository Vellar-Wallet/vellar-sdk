import { describe, expect, it } from "vitest";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { MAINNET, TESTNET, mainnetConfig, type NetworkConfig } from "../../src/config";
import {
  NativeTokenConfigError,
  NetworkConfigMigrationError,
  assertNativeTokenMatchesPassphrase,
  deriveNativeSacContractId,
  migrateNetworkConfig,
  type Pre062NetworkConfig,
} from "./network-config";
import { UsdcNetworkError, UsdcSimulationError, readUsdcBalanceViaSimulation } from "./usdc-simulation";

const HOLDER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const VALID_HASH = "ab".repeat(32);

function legacy(config: NetworkConfig): Pre062NetworkConfig {
  const { usdcIssuer: _issuer, usdcContractId: _contract, ...rest } = config;
  return rest;
}

describe("migrateNetworkConfig (#856)", () => {
  it("fills USDC fields on a pre-0.6.2 testnet literal from the shipped constants", () => {
    const migrated = migrateNetworkConfig(legacy(TESTNET));
    expect(migrated.usdcIssuer).toBe(TESTNET.usdcIssuer);
    expect(migrated.usdcContractId).toBe(TESTNET.usdcContractId);
    expect(migrated.rpcUrl).toBe(TESTNET.rpcUrl);
    expect(migrated.networkPassphrase).toBe(TESTNET.networkPassphrase);
  });

  it("fills USDC fields on a pre-0.6.2 mainnet literal", () => {
    const migrated = migrateNetworkConfig(legacy(MAINNET));
    expect(migrated.usdcIssuer).toBe(MAINNET.usdcIssuer);
    expect(migrated.usdcContractId).toBe(MAINNET.usdcContractId);
  });

  it("throws when the network is neither testnet nor mainnet", () => {
    const input = { ...legacy(TESTNET), network: "futurenet" as Pre062NetworkConfig["network"] };
    expect(() => migrateNetworkConfig(input)).toThrow(NetworkConfigMigrationError);
    expect(() => migrateNetworkConfig(input)).toThrow(/testnet or mainnet/);
  });
});

describe("assertNativeTokenMatchesPassphrase (#854)", () => {
  it("accepts TESTNET, MAINNET, and a mainnetConfig() result", () => {
    expect(() => assertNativeTokenMatchesPassphrase(TESTNET)).not.toThrow();
    expect(() => assertNativeTokenMatchesPassphrase(MAINNET)).not.toThrow();
    const cfg = mainnetConfig({ rpcUrl: "https://rpc.example.com", walletWasmHash: VALID_HASH });
    expect(() => assertNativeTokenMatchesPassphrase(cfg)).not.toThrow();
    expect(deriveNativeSacContractId(cfg.networkPassphrase)).toBe(cfg.nativeTokenContractId);
  });

  it("throws when nativeTokenContractId does not match the passphrase", () => {
    expect(() =>
      assertNativeTokenMatchesPassphrase({
        networkPassphrase: TESTNET.networkPassphrase,
        nativeTokenContractId: MAINNET.nativeTokenContractId,
      }),
    ).toThrow(NativeTokenConfigError);
  });

  it("throws when the passphrase is swapped and the contract id is left behind", () => {
    expect(() =>
      assertNativeTokenMatchesPassphrase({
        networkPassphrase: MAINNET.networkPassphrase,
        nativeTokenContractId: TESTNET.nativeTokenContractId,
      }),
    ).toThrow(/config-consistency guard/);
  });
});

describe("readUsdcBalanceViaSimulation (#853)", () => {
  it("returns the simulated balance for the shipped contract id", async () => {
    const retval = nativeToScVal(42n, { type: "i128" });
    const balance = await readUsdcBalanceViaSimulation({
      usdcContractId: TESTNET.usdcContractId,
      holder: HOLDER,
      networkPassphrase: TESTNET.networkPassphrase,
      simulate: async () => ({ result: { retval } }),
    });
    expect(balance).toBe(42n);
  });

  it("fails loudly with a simulation error for a contract id that is not deployed", async () => {
    const wrongId = MAINNET.usdcContractId;
    await expect(
      readUsdcBalanceViaSimulation({
        usdcContractId: wrongId,
        holder: HOLDER,
        networkPassphrase: TESTNET.networkPassphrase,
        simulate: async () => ({ error: "HostError: Error(Contract, MissingValue)" }),
      }),
    ).rejects.toBeInstanceOf(UsdcSimulationError);
  });

  it("does not treat a missing simulation result as a zero balance", async () => {
    await expect(
      readUsdcBalanceViaSimulation({
        usdcContractId: MAINNET.nativeTokenContractId,
        holder: HOLDER,
        networkPassphrase: TESTNET.networkPassphrase,
        simulate: async () => ({ result: {} }),
      }),
    ).rejects.toThrow(/wrong usdcContractId/);
  });

  it("distinguishes a connectivity failure from a simulation failure", async () => {
    const network = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    await expect(
      readUsdcBalanceViaSimulation({
        usdcContractId: TESTNET.usdcContractId,
        holder: HOLDER,
        networkPassphrase: TESTNET.networkPassphrase,
        simulate: async () => {
          throw network;
        },
      }),
    ).rejects.toBeInstanceOf(UsdcNetworkError);
  });
});
