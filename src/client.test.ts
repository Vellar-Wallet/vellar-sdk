import { describe, expect, it, vi } from "vitest";
import { createVellarWallet, WalletNotReadyError } from "./client";
import type { TokenInfo } from "./balances";

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
});
