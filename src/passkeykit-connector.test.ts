import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChallengeTracker,
  createPasskeyKitConnector,
  defaultSignedToXdr,
  PasskeyAssertionExpiredError,
  PasskeyAssertionReplayedError,
  PasskeyBrowserRequiredError,
  resumeKitConnection,
  WalletNetworkMismatchError,
  type PasskeyKitLike,
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

describe("ChallengeTracker (#230)", () => {
  const FIVE_MIN_MS = 5 * 60 * 1000;

  it("consumes a freshly-registered challenge without throwing", () => {
    const tracker = new ChallengeTracker();
    tracker.register("chal-1");
    expect(() => tracker.consume("chal-1")).not.toThrow();
  });

  it("throws PasskeyAssertionReplayedError on a second consume of the same challenge", () => {
    const tracker = new ChallengeTracker();
    tracker.register("chal-1");
    tracker.consume("chal-1");
    expect(() => tracker.consume("chal-1")).toThrow(PasskeyAssertionReplayedError);
  });

  it("throws PasskeyAssertionExpiredError past maxAgeMs, with the expected fields", () => {
    let now = new Date("2026-07-16T10:00:00.000Z");
    const tracker = new ChallengeTracker({ maxAgeMs: FIVE_MIN_MS, now: () => now });
    tracker.register("chal-1");

    now = new Date("2026-07-16T10:05:01.000Z"); // 5m1s later
    let caught: unknown;
    try {
      tracker.consume("chal-1");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PasskeyAssertionExpiredError);
    const err = caught as PasskeyAssertionExpiredError;
    expect(err.challenge).toBe("chal-1");
    expect(err.issuedAt).toEqual(new Date("2026-07-16T10:00:00.000Z"));
    expect(err.maxAgeMs).toBe(FIVE_MIN_MS);
  });

  it("accepts a challenge consumed exactly at the boundary (ageMs > maxAgeMs, not >=)", () => {
    let now = new Date("2026-07-16T10:00:00.000Z");
    const tracker = new ChallengeTracker({ maxAgeMs: FIVE_MIN_MS, now: () => now });
    tracker.register("chal-1");
    now = new Date("2026-07-16T10:05:00.000Z"); // exactly 5m later
    expect(() => tracker.consume("chal-1")).not.toThrow();
  });

  it("throws a plain Error for a challenge that was never registered", () => {
    const tracker = new ChallengeTracker();
    expect(() => tracker.consume("never-registered")).toThrow(/unknown/i);
  });

  it("re-registering a challenge clears its prior consumed state", () => {
    const tracker = new ChallengeTracker();
    tracker.register("chal-1");
    tracker.consume("chal-1");
    expect(() => tracker.consume("chal-1")).toThrow(PasskeyAssertionReplayedError);

    tracker.register("chal-1"); // e.g. the backend reissued the same string
    expect(() => tracker.consume("chal-1")).not.toThrow();
  });

  it("tracks multiple challenges independently", () => {
    const tracker = new ChallengeTracker();
    tracker.register("chal-a");
    tracker.register("chal-b");
    tracker.consume("chal-a");
    expect(() => tracker.consume("chal-a")).toThrow(PasskeyAssertionReplayedError);
    expect(() => tracker.consume("chal-b")).not.toThrow();
  });

  it("prunes expired entries lazily so long-running processes don't leak memory", () => {
    let now = new Date("2026-07-16T10:00:00.000Z");
    const tracker = new ChallengeTracker({ maxAgeMs: FIVE_MIN_MS, now: () => now });
    tracker.register("stale-challenge");

    now = new Date("2026-07-16T11:00:00.000Z"); // 1h later, well past maxAgeMs
    tracker.register("fresh-challenge"); // triggers a prune pass

    // The pruned challenge is gone entirely — treated as never registered,
    // not merely expired (both throw, but this exercises the prune path).
    expect(() => tracker.consume("stale-challenge")).toThrow(/unknown/i);
    expect(() => tracker.consume("fresh-challenge")).not.toThrow();
  });
});

describe("createPasskeyKitConnector.verifyPasskeyChallenge (#230)", () => {
  it("throws when no challengeTracker was configured", () => {
    const c = createPasskeyKitConnector({
      kit: fakeKit(),
      backend: fakeBackend(),
      network: "testnet",
      appName: "Vellar",
    });
    expect(() => c.verifyPasskeyChallenge("chal-1")).toThrow(/challengeTracker/);
  });

  it("delegates to the configured tracker and consumes the challenge", () => {
    const tracker = new ChallengeTracker();
    tracker.register("chal-1");
    const c = createPasskeyKitConnector({
      kit: fakeKit(),
      backend: fakeBackend(),
      network: "testnet",
      appName: "Vellar",
      challengeTracker: tracker,
    });
    expect(() => c.verifyPasskeyChallenge("chal-1")).not.toThrow();
    expect(() => c.verifyPasskeyChallenge("chal-1")).toThrow(PasskeyAssertionReplayedError);
  });
});
