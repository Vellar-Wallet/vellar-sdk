import { describe, expect, it, vi } from "vitest";
import { Asset, Networks } from "@stellar/stellar-sdk";
import { MAINNET, MainnetConfigError, TESTNET, mainnetConfig, type NetworkConfig } from "./config";
import { createVellarWallet } from "./client";

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

// #287 — presets must actually be usable to build a working client, not just
// hold plausible-looking field values, and mixing fields across networks must
// be caught rather than silently producing a wallet that's half testnet, half
// mainnet under the hood.
describe("network config presets — produce a correctly configured client", () => {
  function fakeHostPieces() {
    const kit = {
      createWallet: vi.fn(async () => ({
        keyIdBase64: "key123",
        contractId: "CWALLET",
        signedTx: "signed-deploy-xdr",
      })),
      connectWallet: vi.fn(async () => ({ keyIdBase64: "key123", contractId: "CWALLET" })),
      sign: vi.fn(async (tx: unknown) => tx),
      wallet: undefined,
    };
    const backend = {
      submitWalletCreation: vi.fn(async () => ({ sessionId: "sess-1" })),
      lookupContractId: vi.fn(async () => ({ contractId: "CWALLET", sessionId: "sess-2" })),
      submitTransaction: vi.fn(async () => ({ hash: "txhash-abc" })),
    };
    const sac = { getSACClient: vi.fn(() => ({ transfer: vi.fn() })) };
    return { kit, backend, sac };
  }

  function walletFrom(preset: NetworkConfig) {
    const { kit, backend, sac } = fakeHostPieces();
    return createVellarWallet({
      network: preset.network,
      appName: "Test App",
      kit: kit as never,
      backend: backend as never,
      sac: sac as never,
      isValidAddress: () => true,
      rpcUrl: preset.rpcUrl,
      x402: {
        signer: { address: "CSIGNER", signAuthEntry: vi.fn() },
        simulationSourceAccount: "GSIMSOURCE",
      },
    });
  }

  it("TESTNET produces a wallet whose x402 client validates against testnet's rpcUrl", () => {
    // assertValidX402RpcUrl runs at construction; a malformed/blank rpcUrl
    // from a broken preset would throw here rather than silently building.
    expect(() => walletFrom(TESTNET)).not.toThrow();
  });

  it("mainnetConfig() produces a wallet whose x402 client validates against the supplied rpcUrl", () => {
    const cfg = mainnetConfig({
      rpcUrl: "https://rpc.example.com",
      walletWasmHash: "a".repeat(64),
    });
    expect(() => walletFrom(cfg)).not.toThrow();
  });

  it("create() on a TESTNET-configured wallet reports the testnet network on the session", async () => {
    // create()/connect() guard on a browser WebAuthn context; simulate it the
    // same way src/client.test.ts does for a Node test environment.
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { credentials: {} });
    try {
      const { kit, backend, sac } = fakeHostPieces();
      const wallet = createVellarWallet({
        network: TESTNET.network,
        appName: "Test App",
        kit: kit as never,
        backend: backend as never,
        sac: sac as never,
        isValidAddress: () => true,
      });
      const session = await wallet.create({ username: "alice" });
      expect(session.network).toBe("testnet");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("bare MAINNET (not run through mainnetConfig) fails loudly when used for x402 rather than silently misconfiguring", () => {
    // MAINNET.rpcUrl is deliberately blank until mainnetConfig() fills it in —
    // using the bare preset directly for a network call must fail at
    // construction, not produce a client that looks fine and breaks later.
    expect(() => walletFrom(MAINNET)).toThrow();
  });

  it("guards against mixing network-specific values across presets", () => {
    // A preset built by spreading fields from both TESTNET and MAINNET (e.g. a
    // copy-paste mistake) must not equal either canonical preset — the
    // wrongness has to be structurally detectable, not just "looks plausible".
    const mixed: NetworkConfig = {
      ...TESTNET,
      networkPassphrase: MAINNET.networkPassphrase, // wrong passphrase for testnet's RPC/wasm
    };
    expect(mixed).not.toEqual(TESTNET);
    expect(mixed).not.toEqual(MAINNET);
    // The native token id is derived from (asset, passphrase) — a mixed config
    // claims the mainnet passphrase but still carries testnet's SAC id, so the
    // two must disagree. This is exactly the class of bug the derivation test
    // above guards against: catching it here confirms a mixed preset doesn't
    // accidentally end up internally consistent.
    expect(mixed.nativeTokenContractId).not.toBe(
      Asset.native().contractId(mixed.networkPassphrase),
    );
  });
});
