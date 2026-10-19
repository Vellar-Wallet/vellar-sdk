import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVellarWallet, WalletNotReadyError } from "./client";
import { PasskeyBrowserRequiredError } from "./passkeykit-connector";
import { X402NotConfiguredError, type SmartAccountX402Signer } from "./x402-types";
import { PolicyNotDeployableError } from "./policy-facade";
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

describe("circuit breaker around facilitator calls", () => {
  it("fast-fails pay() with CircuitOpenError once the breaker opens", async () => {
    const { wallet, backend } = build({
      // Trip the breaker after a single failure so we can observe the fast-fail.
      circuitBreaker: { failureThreshold: 1, openDurationMs: 60_000 },
    });
    await wallet.connect();

    // The reconnect lookup succeeds (breaker stays closed), then break the
    // submission path so the next pay() call trips the circuit.
    backend.submitTransaction.mockRejectedValueOnce(new Error("facilitator down"));

    await expect(wallet.pay({ to: "CDEST", amount: 5n, token })).rejects.toThrow(
      "facilitator down",
    );

    // Circuit is now OPEN: the next pay() must fail fast WITHOUT calling the
    // backend again (no hang, no slow failure).
    backend.submitTransaction.mockClear();
    await expect(wallet.pay({ to: "CDEST", amount: 5n, token })).rejects.toThrow(
      "circuit is open",
    );
    expect(backend.submitTransaction).not.toHaveBeenCalled();
  });

  it("create() fails fast with CircuitOpenError when the breaker is open", async () => {
    const { wallet, backend } = build({
      circuitBreaker: { failureThreshold: 1, openDurationMs: 60_000 },
    });
    backend.submitWalletCreation.mockRejectedValueOnce(new Error("deploy down"));
    await expect(wallet.create({ username: "alice" })).rejects.toThrow("deploy down");

    backend.submitWalletCreation.mockClear();
    await expect(wallet.create({ username: "alice" })).rejects.toThrow("circuit is open");
    expect(backend.submitWalletCreation).not.toHaveBeenCalled();
  });

  it("circuitBreaker: null disables the breaker entirely", async () => {
    const { wallet, backend } = build({ circuitBreaker: null });
    await wallet.connect();
    backend.submitTransaction.mockRejectedValueOnce(new Error("down"));
    await expect(wallet.pay({ to: "CDEST", amount: 1n, token })).rejects.toThrow("down");
    // No fast-fail: the next call still reaches the backend.
    backend.submitTransaction.mockClear();
    await expect(wallet.pay({ to: "CDEST", amount: 1n, token })).resolves.toBeTruthy();
    expect(backend.submitTransaction).toHaveBeenCalledOnce();
  });
});

describe("isValidAddress implementation that throws", () => {
  const boom = new Error("validator exploded on input");
  const throwing = (address: string): boolean => {
    if (address === "CBOOM") throw boom;
    return true;
  };

  it("wallet.pay rejects with the validator's own error, unwrapped and attributable", async () => {
    const { wallet } = build({ isValidAddress: throwing });
    await wallet.connect();

    const err = await wallet.pay({ to: "CBOOM", amount: 5n, token }).catch((e: unknown) => e);
    expect(err).toBe(boom);
  });

  it("never reaches the SAC build, the passkey, or the backend when the validator throws", async () => {
    const { wallet, kit, backend, sac } = build({ isValidAddress: throwing });
    await wallet.connect();

    await expect(wallet.pay({ to: "CBOOM", amount: 5n, token })).rejects.toThrow(
      "validator exploded",
    );
    expect(sac.getSACClient).not.toHaveBeenCalled();
    expect(kit.sign).not.toHaveBeenCalled();
    expect(backend.submitTransaction).not.toHaveBeenCalled();
  });

  it("does not misreport a throwing validator as an invalid-recipient result", async () => {
    const { wallet } = build({ isValidAddress: throwing });
    await wallet.connect();
    const err = await wallet.pay({ to: "CBOOM", amount: 5n, token }).catch((e: unknown) => e);
    expect((err as Error).name).not.toBe("InvalidRecipientError");
  });

  it("a later payment with an input the validator accepts still succeeds", async () => {
    const { wallet } = build({ isValidAddress: throwing });
    await wallet.connect();
    await expect(wallet.pay({ to: "CBOOM", amount: 5n, token })).rejects.toBe(boom);
    await expect(wallet.pay({ to: "CDEST", amount: 5n, token })).resolves.toEqual({
      hash: "txhash-abc",
    });
  });
});

describe("createVellarWallet with kit and sac omitted but policies apiUrl set", () => {
  const API = "https://policies.test";
  const WALLET_ID = "CWALLET1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDE";

  function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  function buildWithoutKit() {
    const gateway = vi.fn<typeof fetch>(async (url) => {
      const u = String(url);
      if (u.includes("/templates")) return jsonResponse({ templates: [{ id: "spending-limit" }] });
      if (u.endsWith("/generate")) return jsonResponse({ policy: { id: "p1", status: "draft" } });
      if (u.endsWith("/simulate")) return jsonResponse({ ok: true });
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", gateway);
    const wallet = createVellarWallet({
      network: "testnet",
      appName: "Test App",
      backend: fakeBackend() as never,
      isValidAddress: () => true,
      apiUrl: API,
    });
    return { wallet, gateway };
  }

  it("constructs without throwing", () => {
    expect(() => buildWithoutKit()).not.toThrow();
  });

  it("policies.listTemplates, generate and simulate succeed against the gateway", async () => {
    const { wallet, gateway } = buildWithoutKit();

    await expect(wallet.policies.listTemplates()).resolves.toBeDefined();
    await expect(
      wallet.policies.generate({ version: "1", type: "spending-limit", owners: ["GOWNER"] }),
    ).resolves.toBeDefined();
    await expect(wallet.policies.simulate("p1", WALLET_ID)).resolves.toEqual({ ok: true });

    const urls = gateway.mock.calls.map(([u]) => String(u));
    expect(urls.every((u) => u.startsWith(API))).toBe(true);
    expect(urls).toHaveLength(3);
  });

  it("connect() fails naming the missing kit, not a generic undefined error", async () => {
    const { wallet } = buildWithoutKit();
    const err = await wallet.connect().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WalletNotReadyError);
    expect((err as Error).message).toMatch(/`kit`/);
    expect((err as Error).message).not.toMatch(/undefined/);
  });

  it("create() fails naming the missing kit", async () => {
    const { wallet } = buildWithoutKit();
    await expect(wallet.create({ username: "alice" })).rejects.toThrow(/`kit`/);
  });

  it("pay() fails naming both the missing kit and sac", async () => {
    const { wallet } = buildWithoutKit();
    const err = await wallet.pay({ to: "CDEST", amount: 5n, token }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WalletNotReadyError);
    expect((err as Error).message).toMatch(/`kit`/);
    expect((err as Error).message).toMatch(/`sac`/);
  });

  it("pay() with a kit but no sac names only the sac", async () => {
    const { wallet } = build({ sac: undefined });
    await wallet.connect();
    const err = await wallet.pay({ to: "CDEST", amount: 5n, token }).catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/`sac`/);
    expect((err as Error).message).not.toMatch(/`kit`/);
  });

  it("policies.deploy fails with the distinct policyAttach-missing error", async () => {
    const { wallet } = buildWithoutKit();
    const err = await wallet.policies.deploy("p1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PolicyNotDeployableError);
    expect((err as Error).message).toMatch(/policyAttach/);
  });

  it("without apiUrl, policies still fails with its own clear error", () => {
    const wallet = createVellarWallet({
      network: "testnet",
      appName: "Test App",
      backend: fakeBackend() as never,
      isValidAddress: () => true,
    });
    expect(() => wallet.policies).toThrow(/apiUrl/);
  });
});
