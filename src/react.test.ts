import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginHookRender, getStoreChangeCount, resetHookRuntime } from "./react-test-runtime";
import { useWallet, VellarProvider } from "./react";
import type { VellarWalletConfig } from "./client";

function makeConfig(connectError?: Error): VellarWalletConfig {
  const kit = {
    createWallet: vi.fn(async () => ({
      keyIdBase64: "key-1",
      contractId: "CWALLET",
      signedTx: "deploy-xdr",
    })),
    connectWallet: vi.fn(async () => {
      if (connectError) throw connectError;
      return { keyIdBase64: "key-1", contractId: "CWALLET" };
    }),
    sign: vi.fn(async (transaction: unknown) => transaction),
    wallet: undefined,
  };
  const backend = {
    submitWalletCreation: vi.fn(async () => ({ sessionId: "session-create" })),
    lookupContractId: vi.fn(async () => ({ contractId: "CWALLET", sessionId: "session-connect" })),
    submitTransaction: vi.fn(async () => ({ hash: "tx-hash" })),
  };

  return {
    network: "testnet",
    appName: "Test App",
    kit: kit as never,
    backend: backend as never,
    sac: {} as never,
    isValidAddress: () => true,
    apiUrl: "https://api.test",
  };
}

function renderHook(config: VellarWalletConfig) {
  beginHookRender();
  VellarProvider({ config, children: null });
  return useWallet();
}

beforeEach(() => {
  resetHookRuntime();
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { credentials: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("React wallet binding", () => {
  it("exposes the session, wallet actions, and policies", () => {
    const wallet = renderHook(makeConfig());

    expect(wallet.session).toBeNull();
    expect(wallet.loading).toBe(false);
    expect(wallet.error).toBeNull();
    expect(typeof wallet.create).toBe("function");
    expect(typeof wallet.connect).toBe("function");
    expect(typeof wallet.pay).toBe("function");
    expect(wallet.policies).toBeDefined();
  });

  it("publishes connect changes to session subscribers", async () => {
    const config = makeConfig();
    const wallet = renderHook(config);

    await wallet.connect();

    expect(getStoreChangeCount()).toBe(1);
    expect(renderHook(config).session?.accountId).toBe("CWALLET");
  });

  it("surfaces action failures through the hook error state", async () => {
    const failure = new Error("connect failed");
    const config = makeConfig(failure);
    const wallet = renderHook(config);

    await expect(wallet.connect()).rejects.toBe(failure);

    const updated = renderHook(config);
    expect(updated.loading).toBe(false);
    expect(updated.error).toBe(failure);
  });
});