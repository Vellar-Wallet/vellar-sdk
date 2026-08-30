import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPasskeyKitConnector,
  defaultSignedToXdr,
  PasskeyBrowserRequiredError,
  resumeKitConnection,
  WalletNetworkMismatchError,
  type PasskeyKitConnectorOptions,
  type PasskeyKitLike,
  type SessionKeyRotationRuntime,
  type WalletBackend,
} from "./passkeykit-connector";

const FIXED_NOW = new Date("2026-07-16T15:00:00.000Z");

// The ceremony entry points guard on a browser WebAuthn context; these unit
// tests run in Node with a mock kit, so simulate the browser globals.
beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { credentials: {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

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
    appName: "Vellar",
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

    expect(kit.createWallet).toHaveBeenCalledWith("Vellar", "dumto");
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
    expect(kit.createWallet).toHaveBeenCalledWith("Vellar", "Vellar user");
    await connector(kit).createWallet({ username: "   ", network: "testnet" });
    expect(kit.createWallet).toHaveBeenLastCalledWith("Vellar", "Vellar user");
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

describe("browser WebAuthn context guard", () => {
  it("createWallet outside a browser fails clearly, before any WebAuthn call", async () => {
    vi.unstubAllGlobals(); // plain Node: no window, no navigator.credentials
    const kit = fakeKit();
    await expect(connector(kit).createWallet({ network: "testnet" })).rejects.toBeInstanceOf(
      PasskeyBrowserRequiredError,
    );
    await expect(connector(kit).createWallet({ network: "testnet" })).rejects.toThrow(
      /createSessionKeySigner/,
    );
    expect(kit.createWallet).not.toHaveBeenCalled();
  });

  it("connectWallet outside a browser fails clearly, before any WebAuthn call", async () => {
    vi.unstubAllGlobals();
    const kit = fakeKit();
    await expect(connector(kit).connectWallet("testnet")).rejects.toBeInstanceOf(
      PasskeyBrowserRequiredError,
    );
    expect(kit.connectWallet).not.toHaveBeenCalled();
  });

  it("a window without a credentials API (e.g. bare jsdom) is also refused", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", {}); // navigator exists but has no credentials
    await expect(connector().createWallet({ network: "testnet" })).rejects.toBeInstanceOf(
      PasskeyBrowserRequiredError,
    );
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

describe("session key rotation on re-authentication (#223)", () => {
  function fakeRotation(overrides: Partial<SessionKeyRotationRuntime> = {}): SessionKeyRotationRuntime & {
    mint: ReturnType<typeof vi.fn>;
    revoke: ReturnType<typeof vi.fn>;
  } {
    return {
      mint: vi.fn().mockResolvedValue({ publicKey: "GNEWKEY000000000000000000000000000000000000000000000000" }),
      revoke: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    } as SessionKeyRotationRuntime & { mint: ReturnType<typeof vi.fn>; revoke: ReturnType<typeof vi.fn> };
  }

  function connectorWithRotation(
    rotation: SessionKeyRotationRuntime,
    extra: Partial<PasskeyKitConnectorOptions> = {},
  ) {
    return createPasskeyKitConnector({
      kit: fakeKit(),
      backend: fakeBackend(),
      network: "testnet",
      appName: "Vellar",
      now: () => FIXED_NOW,
      sessionKeyRotation: rotation,
      ...extra,
    });
  }

  it("does not rotate when sessionKeyRotation is not configured (backward compatible)", async () => {
    const session = await connector().connectWallet("testnet");
    expect(session.accountId).toBe("CCONTRACT");
    // No rotation runtime supplied at all — nothing to assert on except that
    // connectWallet still resolves normally.
  });

  it("mints a fresh session key on successful re-authentication", async () => {
    const rotation = fakeRotation();
    await connectorWithRotation(rotation).connectWallet("testnet");
    expect(rotation.mint).toHaveBeenCalledTimes(1);
  });

  it("does not revoke anything on the first connect (no previous key to invalidate)", async () => {
    const rotation = fakeRotation();
    await connectorWithRotation(rotation).connectWallet("testnet");
    expect(rotation.revoke).not.toHaveBeenCalled();
  });

  it("revokes the previous session key on a second re-authentication", async () => {
    const rotation = fakeRotation();
    rotation.mint
      .mockResolvedValueOnce({ publicKey: "GFIRST00000000000000000000000000000000000000000000000000" })
      .mockResolvedValueOnce({ publicKey: "GSECOND0000000000000000000000000000000000000000000000000" });
    const conn = connectorWithRotation(rotation);

    await conn.connectWallet("testnet");
    expect(rotation.revoke).not.toHaveBeenCalled();

    await conn.connectWallet("testnet");
    expect(rotation.revoke).toHaveBeenCalledTimes(1);
    expect(rotation.revoke).toHaveBeenCalledWith("GFIRST00000000000000000000000000000000000000000000000000");
  });

  it("rejects the old key after rotation: a runtime backed by a real revoke list denies it", async () => {
    // Simulate a runtime backed by a revocation list, standing in for the
    // on-chain signer removal `wallet.agents.revoke` performs.
    const revoked = new Set<string>();
    const rotation: SessionKeyRotationRuntime = {
      mint: vi
        .fn()
        .mockResolvedValueOnce({ publicKey: "GFIRST00000000000000000000000000000000000000000000000000" })
        .mockResolvedValueOnce({ publicKey: "GSECOND0000000000000000000000000000000000000000000000000" }),
      revoke: vi.fn().mockImplementation(async (publicKey: string) => {
        revoked.add(publicKey);
      }),
    };
    const conn = connectorWithRotation(rotation);

    await conn.connectWallet("testnet");
    await conn.connectWallet("testnet");

    expect(revoked.has("GFIRST00000000000000000000000000000000000000000000000000")).toBe(true);
    expect(revoked.has("GSECOND0000000000000000000000000000000000000000000000000")).toBe(false);
  });

  it("still returns a fresh session when minting the new key fails", async () => {
    const rotation = fakeRotation({ mint: vi.fn().mockRejectedValue(new Error("mint down")) });
    const session = await connectorWithRotation(rotation).connectWallet("testnet");
    expect(session.accountId).toBe("CCONTRACT");
  });

  it("still returns a fresh session when revoking the previous key fails", async () => {
    const rotation = fakeRotation();
    const conn = connectorWithRotation(rotation);
    await conn.connectWallet("testnet");
    rotation.revoke.mockRejectedValueOnce(new Error("revoke down"));
    const session = await conn.connectWallet("testnet");
    expect(session.accountId).toBe("CCONTRACT");
  });

  it("logs a session-key-rotated debug event with previous and new public keys", async () => {
    const rotation = fakeRotation();
    rotation.mint
      .mockResolvedValueOnce({ publicKey: "GFIRST00000000000000000000000000000000000000000000000000" })
      .mockResolvedValueOnce({ publicKey: "GSECOND0000000000000000000000000000000000000000000000000" });
    const onDebugLog = vi.fn();
    const conn = connectorWithRotation(rotation, { onDebugLog });

    await conn.connectWallet("testnet");
    expect(onDebugLog).toHaveBeenCalledWith("session-key-rotated", {
      previousPublicKey: undefined,
      newPublicKey: "GFIRST00000000000000000000000000000000000000000000000000",
    });

    await conn.connectWallet("testnet");
    expect(onDebugLog).toHaveBeenCalledWith("session-key-rotated", {
      previousPublicKey: "GFIRST00000000000000000000000000000000000000000000000000",
      newPublicKey: "GSECOND0000000000000000000000000000000000000000000000000",
    });
    expect(onDebugLog).toHaveBeenCalledWith("session-key-revoked", {
      publicKey: "GFIRST00000000000000000000000000000000000000000000000000",
    });
  });

  it("logs mint and revoke failures instead of throwing", async () => {
    const onDebugLog = vi.fn();
    const mintFailing = fakeRotation({ mint: vi.fn().mockRejectedValue(new Error("mint down")) });
    await connectorWithRotation(mintFailing, { onDebugLog }).connectWallet("testnet");
    expect(onDebugLog).toHaveBeenCalledWith(
      "session-key-rotation-mint-failed",
      expect.objectContaining({ error: "mint down" }),
    );

    onDebugLog.mockClear();
    const revokeFailing = fakeRotation();
    const conn = connectorWithRotation(revokeFailing, { onDebugLog });
    await conn.connectWallet("testnet");
    revokeFailing.revoke.mockRejectedValueOnce(new Error("revoke down"));
    await conn.connectWallet("testnet");
    expect(onDebugLog).toHaveBeenCalledWith(
      "session-key-revoke-failed",
      expect.objectContaining({ error: "revoke down" }),
    );
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

  it("simulates session expiry followed by reconnect, covering browser and Node-based consumer paths", async () => {
    class WalletNotConnectedError extends Error {
      constructor() {
        super("Wallet not connected");
        this.name = "WalletNotConnectedError";
      }
    }

    const mockWallet = { id: "wallet-active" };
    const kit: PasskeyKitLike = {
      createWallet: vi.fn(),
      connectWallet: vi.fn().mockImplementation(async (opts) => {
        (kit as any).wallet = mockWallet;
        return { keyIdBase64: opts?.keyId || "key-123", contractId: "CCONTRACT" };
      }),
      sign: vi.fn().mockImplementation(async (tx) => {
        if (!kit.wallet) {
          throw new WalletNotConnectedError();
        }
        return "signed-xdr";
      }),
      wallet: mockWallet,
    };

    const conn = createPasskeyKitConnector({
      kit,
      backend: fakeBackend(),
      network: "testnet",
      appName: "Vellar",
    });
    await expect(conn.signTransaction({ xdr: "tx-xdr", network: "testnet" })).resolves.toEqual({
      signedXdr: "signed-xdr",
    });

    (kit as any).wallet = undefined;

    await expect(conn.signTransaction({ xdr: "tx-xdr", network: "testnet" })).rejects.toBeInstanceOf(
      WalletNotConnectedError,
    );

    await resumeKitConnection(kit, "key-123");

    expect(kit.wallet).toBe(mockWallet);
    await expect(conn.signTransaction({ xdr: "tx-xdr", network: "testnet" })).resolves.toEqual({
      signedXdr: "signed-xdr",
    });

    vi.unstubAllGlobals();
    (kit as any).wallet = undefined;

    await resumeKitConnection(kit, "key-123");
    expect(kit.wallet).toBe(mockWallet);
    
    await expect(conn.signTransaction({ xdr: "tx-xdr", network: "testnet" })).resolves.toEqual({
      signedXdr: "signed-xdr",
    });
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
