import { describe, expect, it } from "vitest";
import { Asset, Networks } from "@stellar/stellar-sdk";
import { MAINNET, MainnetConfigError, TESTNET, mainnetConfig } from "./config";

describe("network config", () => {
  it("TESTNET has all required fields", () => {
    expect(TESTNET.network).toBe("testnet");
    expect(TESTNET.rpcUrl).toBeTruthy();
    expect(TESTNET.walletWasmHash).toMatch(/^[0-9a-f]{64}$/);
    expect(TESTNET.nativeTokenContractId).toMatch(/^C[A-Z2-7]{55}$/);
  });

  it("uses the canonical mainnet passphrase and Horizon", () => {
    expect(MAINNET.network).toBe("mainnet");
    expect(MAINNET.networkPassphrase).toBe(Networks.PUBLIC);
    expect(MAINNET.horizonUrl).toBe("https://horizon.stellar.org");
  });

  it("derives the native XLM SAC ids correctly (not hardcoded on faith)", () => {
    // The native SAC id is deterministic from the asset + passphrase. Deriving
    // it here proves the shipped constants are correct, and guards against a
    // typo silently pointing integrators at the wrong token contract.
    expect(TESTNET.nativeTokenContractId).toBe(Asset.native().contractId(TESTNET.networkPassphrase));
    expect(MAINNET.nativeTokenContractId).toBe(Asset.native().contractId(MAINNET.networkPassphrase));
  });

  it("leaves mainnet rpcUrl and walletWasmHash blank on purpose (fail loud, not silent)", () => {
    // These are deployment/provider-specific and must be supplied by the
    // integrator. A blank value fails loudly; a guessed one fails silently.
    expect(MAINNET.rpcUrl).toBe("");
    expect(MAINNET.walletWasmHash).toBe("");
  });
});

describe("mainnetConfig()", () => {
  const VALID_HASH = "a".repeat(64);

  it("fills the verified fields and applies the supplied values", () => {
    const cfg = mainnetConfig({ rpcUrl: "https://rpc.example.com", walletWasmHash: VALID_HASH });
    expect(cfg.network).toBe("mainnet");
    expect(cfg.networkPassphrase).toBe(Networks.PUBLIC);
    expect(cfg.horizonUrl).toBe("https://horizon.stellar.org");
    expect(cfg.nativeTokenContractId).toBe(MAINNET.nativeTokenContractId);
    expect(cfg.rpcUrl).toBe("https://rpc.example.com");
    expect(cfg.walletWasmHash).toBe(VALID_HASH);
  });

  it("lowercases and trims the wasm hash", () => {
    const cfg = mainnetConfig({ rpcUrl: " https://rpc.example.com ", walletWasmHash: "A".repeat(64) });
    expect(cfg.rpcUrl).toBe("https://rpc.example.com");
    expect(cfg.walletWasmHash).toBe("a".repeat(64));
  });

  it("throws when rpcUrl is missing", () => {
    expect(() => mainnetConfig({ rpcUrl: "", walletWasmHash: VALID_HASH })).toThrow(
      MainnetConfigError,
    );
  });

  it("throws when walletWasmHash is missing or not a 64-char hex hash", () => {
    expect(() => mainnetConfig({ rpcUrl: "https://rpc.example.com", walletWasmHash: "" })).toThrow(
      MainnetConfigError,
    );
    expect(() =>
      mainnetConfig({ rpcUrl: "https://rpc.example.com", walletWasmHash: "not-a-hash" }),
    ).toThrow(MainnetConfigError);
    expect(() =>
      mainnetConfig({ rpcUrl: "https://rpc.example.com", walletWasmHash: "abc" }),
    ).toThrow(MainnetConfigError);
  });
});
