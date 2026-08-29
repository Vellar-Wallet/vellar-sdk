import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVellarWallet, WalletNotReadyError } from "./client";
import { PasskeyBrowserRequiredError } from "./passkeykit-connector";
import { X402NotConfiguredError, type SmartAccountX402Signer } from "./x402-types";
import type { TokenInfo } from "./balances";

// create()/connect() guard on a browser WebAuthn context; these unit tests run
// in Node with a mock kit, so simulate the browser globals.
beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { credentials: {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// The facade composes the connector + payment client. We feed it fakes for the
// three host-supplied pieces (kit, backend, sac) and assert it wires create /
// connect / pay correctly and enforces the "connect before pay" guard.

const token: TokenInfo = { contractId: "CTOKEN", symbol: "XLM", decimals: 7 };

function fakeKit(contractId = "CWALLET") {
  return {
    createWallet: vi.fn(async () => ({
      keyIdBase64: "key123",
      contractId,
      signedTx: "signed-deploy-xdr",
    })),
    connectWallet: vi.fn(async () => ({ keyIdBase64: "key123", contractId })),
    // sign returns the tx unchanged (a string), which defaultSignedToXdr passes through
    sign: vi.fn(async (tx: unknown) => tx),
    wallet: undefined,
  };
}

function fakeBackend() {
  return {
    submitWalletCreation: vi.fn(async () => ({ sessionId: "sess-1" })),
    lookupContractId: vi.fn(async () => ({ contractId: "CWALLET", sessionId: "sess-2" })),
    submitTransaction: vi.fn(async () => ({ hash: "txhash-abc" })),
  };
}

function fakeSac() {
  const transfer = vi.fn(async () => "built-transfer-xdr");
  return {
    getSACClient: vi.fn(() => ({ transfer })),
    _transfer: transfer,
  };
}

function build(overrides: Partial<Parameters<typeof createVellarWallet>[0]> = {}) {
  const kit = fakeKit();
  const backend = fakeBackend();
  const sac = fakeSac();
  const wallet = createVellarWallet({
    network: "testnet",
    appName: "Test App",
    kit: kit as never,
    backend: backend as never,
    sac: sac as never,
    isValidAddress: () => true,
    ...overrides,
  });
  return { wallet, kit, backend, sac };
}

describe("createVellarWallet", () => {
  it("starts with no session", () => {
    const { wallet } = build();
    expect(wallet.session).toBeNull();
  });

  it("create() registers a passkey, submits deployment, and sets the session", async () => {
    const { wallet, kit, backend } = build();
    const session = await wallet.create({ username: "alice" });

    expect(kit.createWallet).toHaveBeenCalledWith("Test App", "alice");
    expect(backend.submitWalletCreation).toHaveBeenCalledOnce();
    expect(session.accountId).toBe("CWALLET");
    expect(session.network).toBe("testnet");
    expect(wallet.session).toBe(session);
  });

  it("connect() restores the session via the backend lookup", async () => {
    const { wallet, kit } = build();
    const session = await wallet.connect();

    expect(kit.connectWallet).toHaveBeenCalledOnce();
    expect(session.accountId).toBe("CWALLET");
    expect(wallet.session).toBe(session);
  });

  it("pay() before connect throws WalletNotReadyError", async () => {
    const { wallet } = build();
    await expect(wallet.pay({ to: "CDEST", amount: 5n, token })).rejects.toBeInstanceOf(
      WalletNotReadyError,
    );
  });

  it("pay() builds, signs, and submits — returning the tx hash", async () => {
    const { wallet, kit, backend, sac } = build();
    await wallet.connect();

    const result = await wallet.pay({ to: "CDEST", amount: 5n, token });

    // Built the transfer via the SAC client for the right token.
    expect(sac.getSACClient).toHaveBeenCalledWith("CTOKEN");
    // Signed with the passkey and submitted via the backend.
    expect(kit.sign).toHaveBeenCalledOnce();
    expect(backend.submitTransaction).toHaveBeenCalledOnce();
    expect(result.hash).toBe("txhash-abc");
  });

  it("pay() with the same paymentId across two calls submits only once (#240)", async () => {
    const { wallet, kit, backend } = build();
    await wallet.connect();

    const first = await wallet.pay({ to: "CDEST", amount: 5n, token, paymentId: "pay-1" });
    const second = await wallet.pay({ to: "CDEST", amount: 5n, token, paymentId: "pay-1" });

    expect(first).toEqual(second);
    expect(kit.sign).toHaveBeenCalledTimes(1);
    expect(backend.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("pay() without a paymentId submits independently each call (unchanged default behavior)", async () => {
    const { wallet, kit, backend } = build();
    await wallet.connect();

    await wallet.pay({ to: "CDEST", amount: 5n, token });
    await wallet.pay({ to: "CDEST", amount: 5n, token });

    expect(kit.sign).toHaveBeenCalledTimes(2);
    expect(backend.submitTransaction).toHaveBeenCalledTimes(2);
  });

  it("rejects a payment to an invalid address before signing", async () => {
    const { wallet, kit } = build({ isValidAddress: () => false });
    await wallet.connect();

    await expect(wallet.pay({ to: "bad", amount: 5n, token })).rejects.toThrow();
    // Never reached the passkey.
    expect(kit.sign).not.toHaveBeenCalled();
  });

  it("exposes the lower-level connector and payments for advanced use", () => {
    const { wallet } = build();
    expect(typeof wallet.connector.signTransaction).toBe("function");
    expect(typeof wallet.payments.preparePayment).toBe("function");
  });

  it("create() in a non-browser environment fails with the clear passkey error", async () => {
    vi.unstubAllGlobals(); // plain Node: no window, no navigator.credentials
    const { wallet, kit } = build();
    await expect(wallet.create({ username: "alice" })).rejects.toBeInstanceOf(
      PasskeyBrowserRequiredError,
    );
    expect(kit.createWallet).not.toHaveBeenCalled();
  });
});

describe("x402 rpcUrl validation at construction", () => {
  const signer: SmartAccountX402Signer = {
    address: "CWALLET",
    async signAuthEntry() {
      throw new Error("signer should not be called in these tests");
    },
  };

  function x402Config(rpcUrl?: string) {
    return { signer, simulationSourceAccount: "GSOURCE", ...(rpcUrl !== undefined && { rpcUrl }) };
  }

  it("an empty-string rpcUrl throws X402NotConfiguredError, not a raw TypeError", () => {
    expect(() => build({ x402: x402Config(""), rpcUrl: "" })).toThrow(X402NotConfiguredError);
  });

  it("a missing rpcUrl (neither x402.rpcUrl nor top-level) throws at construction", () => {
    expect(() => build({ x402: x402Config() })).toThrow(X402NotConfiguredError);
  });

  it("non-URL garbage throws, and the message names the fix with an example", () => {
    expect(() => build({ x402: x402Config("not a url") })).toThrow(
      /soroban-testnet\.stellar\.org/,
    );
  });

  it("a valid x402.rpcUrl passes construction", () => {
    const { wallet } = build({ x402: x402Config("https://soroban-testnet.stellar.org") });
    expect(wallet.x402).toBeDefined();
  });

  it("a valid top-level rpcUrl also satisfies x402", () => {
    const { wallet } = build({
      x402: x402Config(),
      rpcUrl: "https://soroban-testnet.stellar.org",
    });
    expect(wallet.x402).toBeDefined();
  });

  it("no x402 config at all still constructs (x402 stays lazily unconfigured)", () => {
    const { wallet } = build();
    expect(wallet.x402).toBeDefined();
  });
});
