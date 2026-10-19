import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPasskeyKitConnector,
  PasskeyBrowserRequiredError,
  type PasskeyKitLike,
  type WalletBackend,
} from "../../src/passkeykit-connector";
import {
  isWebAuthnAvailable,
  WebAuthnUnavailableError,
  withWebAuthnCapabilityCheck,
} from "./webauthn-capability";

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeKit(): PasskeyKitLike {
  return {
    createWallet: vi.fn().mockResolvedValue({
      keyIdBase64: "key-1",
      contractId: "CWALLET",
      signedTx: "xdr",
    }),
    connectWallet: vi.fn().mockResolvedValue({ keyIdBase64: "key-1", contractId: "CWALLET" }),
    sign: vi.fn().mockResolvedValue("signed"),
  };
}

function fakeBackend(): WalletBackend {
  return {
    submitWalletCreation: vi.fn().mockResolvedValue({ sessionId: "s1" }),
    lookupContractId: vi.fn().mockResolvedValue({ contractId: "CWALLET", sessionId: "s2" }),
  };
}

function build(kit = fakeKit(), backend = fakeBackend()) {
  const inner = createPasskeyKitConnector({
    kit,
    backend,
    network: "testnet",
    appName: "Vellar",
  });
  return { kit, backend, connector: inner };
}

describe("isWebAuthnAvailable", () => {
  it("is true with window and navigator.credentials", () => {
    expect(isWebAuthnAvailable({ window: {}, navigator: { credentials: {} } })).toBe(true);
  });

  it.each([
    ["navigator.credentials undefined", { window: {}, navigator: { credentials: undefined } }],
    ["navigator without credentials", { window: {}, navigator: {} }],
    ["navigator undefined", { window: {}, navigator: undefined }],
    ["no window", { navigator: { credentials: {} } }],
  ])("is false with %s", (_label, env) => {
    expect(isWebAuthnAvailable(env)).toBe(false);
  });
});

describe("core connector with navigator.credentials undefined", () => {
  it("throws the named capability error, not a TypeError, before touching the kit", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { credentials: undefined });
    const { kit, backend, connector } = build();

    const create = connector.createWallet({ network: "testnet" });
    await expect(create).rejects.toBeInstanceOf(PasskeyBrowserRequiredError);
    await expect(create).rejects.not.toBeInstanceOf(TypeError);
    await expect(connector.connectWallet("testnet")).rejects.toBeInstanceOf(
      PasskeyBrowserRequiredError,
    );
    expect(kit.createWallet).not.toHaveBeenCalled();
    expect(kit.connectWallet).not.toHaveBeenCalled();
    expect(backend.submitWalletCreation).not.toHaveBeenCalled();
    expect(backend.lookupContractId).not.toHaveBeenCalled();
  });

  it("an entirely undefined navigator is refused the same way", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", undefined);
    await expect(build().connector.connectWallet("testnet")).rejects.toBeInstanceOf(
      PasskeyBrowserRequiredError,
    );
  });
});

describe("withWebAuthnCapabilityCheck", () => {
  const missing = { window: {}, navigator: { credentials: undefined } };

  it("createWallet fails up front with the named error and a check-capability hint", async () => {
    const { kit, connector } = build();
    const guarded = withWebAuthnCapabilityCheck(connector, missing);

    const create = guarded.createWallet({ network: "testnet" });
    await expect(create).rejects.toBeInstanceOf(WebAuthnUnavailableError);
    await expect(create).rejects.toBeInstanceOf(PasskeyBrowserRequiredError);
    await expect(create).rejects.toThrow(
      /Check isWebAuthnAvailable\(\) before calling create or connect/,
    );
    await expect(create).rejects.toMatchObject({
      name: "WebAuthnUnavailableError",
    });
    expect(kit.createWallet).not.toHaveBeenCalled();
  });

  it("connectWallet fails up front with the named error", async () => {
    const { kit, connector } = build();
    const guarded = withWebAuthnCapabilityCheck(connector, missing);
    await expect(guarded.connectWallet("testnet")).rejects.toBeInstanceOf(WebAuthnUnavailableError);
    expect(kit.connectWallet).not.toHaveBeenCalled();
  });

  it("passes through to the connector when WebAuthn is available (happy path)", async () => {
    const { kit, connector } = build();
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { credentials: {} });
    const guarded = withWebAuthnCapabilityCheck(connector);

    const created = await guarded.createWallet({ network: "testnet" });
    expect(created.accountId).toBe("CWALLET");
    const connected = await guarded.connectWallet("testnet");
    expect(connected.accountId).toBe("CWALLET");
    await expect(guarded.signTransaction({ xdr: "tx", network: "testnet" })).resolves.toEqual({
      signedXdr: "signed",
    });
    expect(kit.createWallet).toHaveBeenCalledTimes(1);
  });
});
