// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VellarWalletConfig } from "./client";
import { useWallet, VellarProvider } from "./react";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  Object.defineProperty(navigator, "credentials", { value: {}, configurable: true });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function config(lookup: () => Promise<{ contractId: string; sessionId: string } | undefined> = async () => ({
  contractId: "CWALLET",
  sessionId: "server-session",
})): VellarWalletConfig {
  return {
    network: "testnet",
    appName: "React test",
    kit: {
      createWallet: vi.fn(async () => ({ keyIdBase64: "key", contractId: "CWALLET", signedTx: "xdr" })),
      connectWallet: vi.fn(async (options?: { getContractId?: (keyId: string) => Promise<string | undefined> }) => {
        await options?.getContractId?.("key");
        return { keyIdBase64: "key", contractId: "CWALLET" };
      }),
      sign: vi.fn(async (transaction) => transaction),
    },
    backend: {
      submitWalletCreation: vi.fn(async () => ({ sessionId: "server-session" })),
      lookupContractId: vi.fn(lookup),
      submitTransaction: vi.fn(async () => ({ hash: "tx-hash" })),
    },
    sac: { getSACClient: () => ({ transfer: async () => "transfer-xdr" }) } as never,
    isValidAddress: () => true,
    apiUrl: "https://api.example.test",
  };
}

function mount(walletConfig: VellarWalletConfig): HTMLDivElement {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <VellarProvider config={walletConfig}>
        <WalletProbe />
      </VellarProvider>,
    );
  });
  return container;
}

function WalletProbe() {
  const wallet = useWallet();
  return (
    <>
      <output id="session">{wallet.session?.accountId ?? "disconnected"}</output>
      <output id="actions">
        {typeof wallet.create}:{typeof wallet.connect}:{typeof wallet.pay}:{String(Boolean(wallet.policies))}
      </output>
      <output id="loading">{String(wallet.loading)}</output>
      <output id="error">{wallet.error instanceof Error ? wallet.error.message : ""}</output>
      <button id="connect" onClick={() => void wallet.connect().catch(() => {})}>Connect</button>
    </>
  );
}

describe("optional React binding", () => {
  it("exposes the session, actions, and policies surface", () => {
    const view = mount(config());

    expect(view.querySelector("#session")?.textContent).toBe("disconnected");
    expect(view.querySelector("#actions")?.textContent).toBe("function:function:function:true");
  });

  it("updates consumers when connect establishes a session", async () => {
    const view = mount(config());

    await act(async () => {
      view.querySelector<HTMLButtonElement>("#connect")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(view.querySelector("#session")?.textContent).toBe("CWALLET");
    expect(view.querySelector("#loading")?.textContent).toBe("false");
  });

  it("surfaces action failures through the hook error state", async () => {
    const view = mount(config(async () => {
      throw new Error("gateway unavailable");
    }));

    await act(async () => {
      view.querySelector<HTMLButtonElement>("#connect")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(view.querySelector("#error")?.textContent).toBe("gateway unavailable");
    expect(view.querySelector("#session")?.textContent).toBe("disconnected");
  });
});