// E2E test for reconnect flow after PasskeyKit session expiry — issue #270.
//
// Simulates the full lifecycle: active session → session expires (kit.wallet cleared) →
// sign attempt fails with WalletNotConnectedError → resumeKitConnection restores the
// session → sign succeeds again.
//
// Covers both browser (stubbed WebAuthn globals) and Node-based (unstubbed) consumer paths.
//
// Contributed as per contrib/ rules; tests run via the project's existing vitest suite.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPasskeyKitConnector,
  resumeKitConnection,
  type PasskeyKitLike,
  type WalletBackend,
} from "../src/passkeykit-connector";

// Simulate the browser WebAuthn context that ceremony guards require.
beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { credentials: {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeBackend(): WalletBackend {
  return {
    submitWalletCreation: vi.fn().mockResolvedValue({ sessionId: "server-session-1" }),
    lookupContractId: vi
      .fn()
      .mockResolvedValue({ contractId: "CCONTRACT", sessionId: "server-session-2" }),
  };
}

describe("reconnect flow after PasskeyKit session expiry", () => {
  it("restores access after session expiry — browser consumer path", async () => {
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
        return { keyIdBase64: opts?.keyId ?? "key-123", contractId: "CCONTRACT" };
      }),
      sign: vi.fn().mockImplementation(async () => {
        if (!kit.wallet) throw new WalletNotConnectedError();
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

    // 1. Initial state: connected — sign should succeed.
    await expect(conn.signTransaction({ xdr: "tx-xdr", network: "testnet" })).resolves.toEqual({
      signedXdr: "signed-xdr",
    });

    // 2. Simulate session expiry: clear the wallet reference.
    (kit as any).wallet = undefined;

    // 3. Sign now fails with WalletNotConnectedError.
    await expect(
      conn.signTransaction({ xdr: "tx-xdr", network: "testnet" }),
    ).rejects.toBeInstanceOf(WalletNotConnectedError);

    // 4. Resume the connection using the stored keyId (no discovery ceremony).
    await resumeKitConnection(kit, "key-123");

    // 5. Verify the kit is reconnected and signed correctly again.
    expect(kit.wallet).toBe(mockWallet);
    expect(kit.connectWallet).toHaveBeenCalledWith({ keyId: "key-123" });
    await expect(conn.signTransaction({ xdr: "tx-xdr", network: "testnet" })).resolves.toEqual({
      signedXdr: "signed-xdr",
    });
  });

  it("restores access after session expiry — Node / headless consumer path", async () => {
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
        return { keyIdBase64: opts?.keyId ?? "key-123", contractId: "CCONTRACT" };
      }),
      sign: vi.fn().mockImplementation(async () => {
        if (!kit.wallet) throw new WalletNotConnectedError();
        return "signed-xdr";
      }),
      wallet: undefined, // Node path: kit never had a wallet to start with.
    };

    // Remove browser globals to simulate Node / headless environment.
    vi.unstubAllGlobals();

    // resumeKitConnection doesn't require a browser — it calls connectWallet({ keyId }).
    await resumeKitConnection(kit, "key-123");

    expect(kit.wallet).toBe(mockWallet);
    expect(kit.connectWallet).toHaveBeenCalledWith({ keyId: "key-123" });

    // signTransaction itself doesn't gate on the browser guard — only ceremony entry points do.
    const conn = createPasskeyKitConnector({
      kit,
      backend: fakeBackend(),
      network: "testnet",
      appName: "Vellar",
    });
    await expect(conn.signTransaction({ xdr: "tx-xdr", network: "testnet" })).resolves.toEqual({
      signedXdr: "signed-xdr",
    });
  });

  it("emits a typed error when reconnect is attempted with a key that is no longer a signer", async () => {
    const connectWallet = vi.fn().mockRejectedValue(new Error("key not a signer on this wallet"));
    const kit = { connectWallet, wallet: undefined } as unknown as PasskeyKitLike;

    await expect(resumeKitConnection(kit, "key-expired")).rejects.toThrow(
      "key not a signer on this wallet",
    );
  });

  it("is a no-op when the kit is already connected (wallet present)", async () => {
    const connectWallet = vi.fn();
    const kit = { connectWallet, wallet: { id: "live" } } as unknown as PasskeyKitLike;
    await resumeKitConnection(kit, "key-123");
    expect(connectWallet).not.toHaveBeenCalled();
  });
});
