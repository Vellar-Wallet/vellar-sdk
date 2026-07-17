import { describe, expect, it, vi } from "vitest";
import {
  createPasskeyKitConnector,
  defaultSignedToXdr,
  resumeKitConnection,
  WalletNetworkMismatchError,
  type PasskeyKitLike,
  type WalletBackend,
} from "./passkeykit-connector";

const FIXED_NOW = new Date("2026-07-16T15:00:00.000Z");

function fakeKit(overrides: Partial<PasskeyKitLike> = {}): PasskeyKitLike {
  return {
    createWallet: vi.fn().mockResolvedValue({
      keyIdBase64: "key-123",
      contractId: "CCONTRACT",
      signedTx: "deploy-xdr",
    }),
    connectWallet: vi.fn().mockResolvedValue({ keyIdBase64: "key-123", contractId: "CCONTRACT" }),
    sign: vi.fn().mockResolvedValue("signed-xdr"),
    ...overrides,
  };
}

function fakeBackend(overrides: Partial<WalletBackend> = {}): WalletBackend {
  return {
    submitWalletCreation: vi.fn().mockResolvedValue({ sessionId: "server-session-1" }),
    lookupContractId: vi
      .fn()
      .mockResolvedValue({ contractId: "CCONTRACT", sessionId: "server-session-2" }),
    ...overrides,
  };
}

function connector(kit = fakeKit(), backend = fakeBackend()) {
  return createPasskeyKitConnector({
    kit,
    backend,
    network: "testnet",
    appName: "VELA",
    now: () => FIXED_NOW,
  });
}

describe("createWallet", () => {
  it("registers, submits deployment through the backend, and returns a session", async () => {
    const kit = fakeKit();
    const backend = fakeBackend();
    const session = await connector(kit, backend).createWallet({
      username: "dumto",
      network: "testnet",
    });

    expect(kit.createWallet).toHaveBeenCalledWith("VELA", "dumto");
    expect(backend.submitWalletCreation).toHaveBeenCalledWith({
      keyId: "key-123",
      contractId: "CCONTRACT",
      network: "testnet",
      signedTx: "deploy-xdr",
    });
    expect(session).toEqual({
      accountId: "CCONTRACT",
      network: "testnet",
      connected: true,
      authMethod: "passkey",
      createdAt: FIXED_NOW.toISOString(),
      lastActiveAt: FIXED_NOW.toISOString(),
      keyId: "key-123",
      serverSessionId: "server-session-1",
    });
  });

  it("defaults a missing or blank username", async () => {
    const kit = fakeKit();
    await connector(kit).createWallet({ network: "testnet" });
    expect(kit.createWallet).toHaveBeenCalledWith("VELA", "VELA user");
    await connector(kit).createWallet({ username: "   ", network: "testnet" });
    expect(kit.createWallet).toHaveBeenLastCalledWith("VELA", "VELA user");
  });

  it("does not return a session when backend submission fails", async () => {
    const backend = fakeBackend({
      submitWalletCreation: vi.fn().mockRejectedValue(new Error("relayer down")),
    });
    await expect(
      connector(fakeKit(), backend).createWallet({ network: "testnet" }),
    ).rejects.toThrow("relayer down");
  });

  it("propagates passkey cancellation without touching the backend", async () => {
    const cancel = new Error("user cancelled");
    cancel.name = "NotAllowedError";
    const kit = fakeKit({ createWallet: vi.fn().mockRejectedValue(cancel) });
    const backend = fakeBackend();
    await expect(connector(kit, backend).createWallet({ network: "testnet" })).rejects.toThrow(
      "user cancelled",
    );
    expect(backend.submitWalletCreation).not.toHaveBeenCalled();
  });

  it("rejects a network mismatch before any passkey prompt", async () => {
    const kit = fakeKit();
    await expect(connector(kit).createWallet({ network: "mainnet" })).rejects.toBeInstanceOf(
      WalletNetworkMismatchError,
    );
    expect(kit.createWallet).not.toHaveBeenCalled();
  });
});

describe("connectWallet", () => {
  it("authenticates and restores the account mapping via backend lookup", async () => {
    const kit = fakeKit();
    const backend = fakeBackend();
    const session = await connector(kit, backend).connectWallet("testnet");

    expect(kit.connectWallet).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(kit.connectWallet).mock.calls[0]?.[0];
    await expect(opts?.getContractId?.("key-123")).resolves.toBe("CCONTRACT");
    expect(backend.lookupContractId).toHaveBeenCalledWith({
      keyId: "key-123",
      network: "testnet",
    });
    expect(session.accountId).toBe("CCONTRACT");
    expect(session.connected).toBe(true);
  });

  it("captures the server session id opened by the resolving lookup", async () => {
    const kit = fakeKit({
      connectWallet: vi.fn().mockImplementation(async (opts) => {
        const contractId = await opts?.getContractId?.("key-123");
        return { keyIdBase64: "key-123", contractId };
      }),
    });
    const session = await connector(kit, fakeBackend()).connectWallet("testnet");
    expect(session.serverSessionId).toBe("server-session-2");
    expect(session.keyId).toBe("key-123");
  });

  it("omits serverSessionId when the kit resolves without our lookup", async () => {
    // e.g. the kit resolved the wallet from its own cached keyId->contract state.
    const kit = fakeKit({
      connectWallet: vi.fn().mockResolvedValue({ keyIdBase64: "key-123", contractId: "CCONTRACT" }),
    });
    const session = await connector(kit, fakeBackend()).connectWallet("testnet");
    expect(session.serverSessionId).toBeUndefined();
  });

  it("rejects a network mismatch", async () => {
    await expect(connector().connectWallet("mainnet")).rejects.toBeInstanceOf(
      WalletNetworkMismatchError,
    );
  });
});

describe("signTransaction", () => {
  it("signs and returns the XDR", async () => {
    const kit = fakeKit();
    const result = await connector(kit).signTransaction({ xdr: "tx-xdr", network: "testnet" });
    expect(kit.sign).toHaveBeenCalledWith("tx-xdr");
    expect(result).toEqual({ signedXdr: "signed-xdr" });
  });

  it("converts object results via toXDR()", async () => {
    const kit = fakeKit({
      sign: vi.fn().mockResolvedValue({ toXDR: () => "object-xdr" }),
    });
    const result = await connector(kit).signTransaction({ xdr: "tx-xdr", network: "testnet" });
    expect(result.signedXdr).toBe("object-xdr");
  });

  it("rejects a network mismatch before prompting", async () => {
    const kit = fakeKit();
    await expect(
      connector(kit).signTransaction({ xdr: "tx-xdr", network: "mainnet" }),
    ).rejects.toBeInstanceOf(WalletNetworkMismatchError);
    expect(kit.sign).not.toHaveBeenCalled();
  });
});

describe("resumeKitConnection", () => {
  it("reconnects a fresh kit by keyId, skipping the discovery ceremony", async () => {
    const connectWallet = vi
      .fn()
      .mockResolvedValue({ keyIdBase64: "key-123", contractId: "CCONTRACT" });
    await resumeKitConnection({ connectWallet, wallet: undefined }, "key-123");
    expect(connectWallet).toHaveBeenCalledWith({ keyId: "key-123" });
  });

  it("is a no-op when the kit is already connected", async () => {
    const connectWallet = vi.fn();
    await resumeKitConnection({ connectWallet, wallet: {} }, "key-123");
    expect(connectWallet).not.toHaveBeenCalled();
  });

  it("propagates connection failures (e.g. key no longer a signer)", async () => {
    const connectWallet = vi.fn().mockRejectedValue(new Error("not a signer"));
    await expect(
      resumeKitConnection({ connectWallet, wallet: undefined }, "key-123"),
    ).rejects.toThrow("not a signer");
  });
});

describe("defaultSignedToXdr", () => {
  it("passes strings through", () => {
    expect(defaultSignedToXdr("xdr")).toBe("xdr");
  });

  it("calls toXDR on objects", () => {
    expect(defaultSignedToXdr({ toXDR: () => "xdr" })).toBe("xdr");
  });

  it("throws a TypeError on anything else", () => {
    expect(() => defaultSignedToXdr(42)).toThrow(TypeError);
    expect(() => defaultSignedToXdr(null)).toThrow(TypeError);
    expect(() => defaultSignedToXdr({})).toThrow(TypeError);
  });
});
