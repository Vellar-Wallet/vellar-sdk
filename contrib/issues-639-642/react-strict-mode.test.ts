import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createVellarWallet, type VellarWallet } from "../../src/client";
import type { WalletSession } from "../../src/types";
import { connectOnce, createConnectHooks, type ConnectState } from "./react-strict-mode";

// React 19 and jsdom are dev-only requirements of this test and are not yet in
// package.json; without them the suite skips instead of failing the build.
const deps = await Promise.all([import("react"), import("react-dom/client"), import("jsdom")]).catch(
  () => null,
);

function fakeWallet(opts: { connect?: () => Promise<{ keyIdBase64: string; contractId: string }> } = {}) {
  const connectWallet = vi.fn(
    opts.connect ?? (async () => ({ keyIdBase64: "key123", contractId: "CWALLET" })),
  );
  const wallet = createVellarWallet({
    network: "testnet",
    appName: "Test App",
    kit: { createWallet: vi.fn(), connectWallet, sign: vi.fn(), wallet: undefined } as never,
    backend: {
      submitWalletCreation: vi.fn(),
      lookupContractId: vi.fn(),
      submitTransaction: vi.fn(),
    } as never,
    sac: { getSACClient: vi.fn() } as never,
    isValidAddress: () => true,
  });
  return { wallet, connectWallet };
}

describe.skipIf(!deps)("React 19 strict mode with a VellarWallet handle (issue #642)", () => {
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let container: HTMLElement;
  let useWalletConnect: (w: VellarWallet) => ConnectState;
  let useWalletConnectNaive: (w: VellarWallet) => ConnectState;

  beforeAll(() => {
    const { JSDOM } = deps![2];
    const dom = new JSDOM("<!doctype html><div id='root'></div>");
    vi.stubGlobal("window", dom.window);
    vi.stubGlobal("document", dom.window.document);
    vi.stubGlobal("navigator", { userAgent: "node", credentials: {} });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    React = deps![0];
    createRoot = deps![1].createRoot;
    ({ useWalletConnect, useWalletConnectNaive } = createConnectHooks(React));
    container = dom.window.document.getElementById("root")!;
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  async function mount(hook: (w: VellarWallet) => ConnectState, wallet: VellarWallet, strict = true) {
    const seen: ConnectState[] = [];
    function Probe() {
      seen.push(hook(wallet));
      return null;
    }
    const root = createRoot(container);
    const tree = strict
      ? React.createElement(React.StrictMode, null, React.createElement(Probe))
      : React.createElement(Probe);
    await React.act(async () => {
      root.render(tree);
    });
    await React.act(async () => {
      await Promise.resolve();
    });
    return { seen, last: () => seen[seen.length - 1]!, unmount: () => React.act(async () => root.unmount()) };
  }

  it("proves the harness: a naive effect connects twice under strict mode", async () => {
    const { wallet, connectWallet } = fakeWallet();
    const m = await mount(useWalletConnectNaive, wallet);
    expect(connectWallet).toHaveBeenCalledTimes(2);
    await m.unmount();
  });

  it("connects exactly once under strict mode (one passkey prompt)", async () => {
    const { wallet, connectWallet } = fakeWallet();
    const m = await mount(useWalletConnect, wallet);
    expect(connectWallet).toHaveBeenCalledTimes(1);
    expect(m.last()).toMatchObject({ status: "connected" });
    expect((m.last().session as WalletSession).accountId).toBe("CWALLET");
    await m.unmount();
  });

  it("connects once without strict mode too", async () => {
    const { wallet, connectWallet } = fakeWallet();
    const m = await mount(useWalletConnect, wallet, false);
    expect(connectWallet).toHaveBeenCalledTimes(1);
    expect(m.last().status).toBe("connected");
    await m.unmount();
  });

  it("ignores the result of an unmounted effect instead of updating state", async () => {
    let release!: () => void;
    const { wallet, connectWallet } = fakeWallet({
      connect: () =>
        new Promise((resolve) => {
          release = () => resolve({ keyIdBase64: "key123", contractId: "CWALLET" });
        }),
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const m = await mount(useWalletConnect, wallet);
    expect(m.last().status).toBe("connecting");
    await m.unmount();
    await React.act(async () => {
      release();
      await Promise.resolve();
    });
    expect(connectWallet).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("surfaces a rejected connect as an error state, still with a single call", async () => {
    const { wallet, connectWallet } = fakeWallet({
      connect: async () => {
        throw new Error("user cancelled passkey prompt");
      },
    });
    const m = await mount(useWalletConnect, wallet);
    expect(connectWallet).toHaveBeenCalledTimes(1);
    expect(m.last()).toMatchObject({ status: "error" });
    expect((m.last().error as Error).message).toMatch(/cancelled|connect/i);
    await m.unmount();
  });

  it("allows a new attempt after a failure has settled", async () => {
    let n = 0;
    const { wallet, connectWallet } = fakeWallet({
      connect: async () => {
        if (n++ === 0) throw new Error("first attempt fails");
        return { keyIdBase64: "key123", contractId: "CWALLET" };
      },
    });
    await expect(connectOnce(wallet)).rejects.toThrow();
    await expect(connectOnce(wallet)).resolves.toMatchObject({ accountId: "CWALLET" });
    expect(connectWallet).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight connect between concurrent callers", async () => {
    const { wallet, connectWallet } = fakeWallet();
    const [a, b] = await Promise.all([connectOnce(wallet), connectOnce(wallet)]);
    expect(a).toBe(b);
    expect(connectWallet).toHaveBeenCalledTimes(1);
  });
});
