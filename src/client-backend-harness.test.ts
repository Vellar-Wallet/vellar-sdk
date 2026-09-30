import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVellarWallet } from "./client";
import { createHttpWalletBackend } from "./http-backend";
import type { PasskeyKitLike } from "./passkeykit-connector";

// Integration harness: wires `client.ts` (createVellarWallet) to a mock backend
// server via `http-backend.ts` (createHttpWalletBackend). The "server" is a
// path-routing mock fetch injected as the backend's `fetchImpl`, so the client's
// full init / submission / balance path runs over the exact transport
// createHttpWalletBackend uses in production — without any Node types (the SDK
// stays browser-safe) or external network.
//
// Run as part of `npm test` (it is hermetic). See CONTRIBUTING.md for local-run
// instructions.

const API_URL = "https://mock-backend.test";
const CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

type MockFetch = typeof fetch;

/** A path-routing mock "server" standing in for the gateway base URL. */
function makeMockServer(store: { calls: string[] }): MockFetch {
  const server = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const path = new URL(String(input)).pathname;
    const method = init?.method ?? "GET";
    store.calls.push(`${method} ${path}`);
    let body: Record<string, unknown> = {};
    if (init?.body) body = JSON.parse(String(init.body));
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (path === "/wallet/create") {
      return json({ sessionId: "sess-create" });
    }
    if (path === "/wallet/connect") {
      return json({ contractId: CONTRACT, sessionId: "sess-connect" });
    }
    if (path === "/wallet/submit") {
      return json({ hash: "txhash-submit" });
    }
    if (path === "/wallet/balance") {
      return json({
        contractId: body["contractId"],
        balances: [{ symbol: "XLM", amount: "10000000" }],
      });
    }
    return new Response(null, { status: 404 });
  };
  return server as MockFetch;
}

const token = { contractId: "CTOKEN", symbol: "XLM", decimals: 7 };

describe("client.ts ↔ http-backend.ts integration harness", () => {
  beforeEach(() => {
    // connect() runs a passkey (WebAuthn) ceremony guard; simulate the browser.
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { credentials: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function fakeKit() {
    return {
      createWallet: vi.fn(async () => ({
        keyIdBase64: "key123",
        contractId: CONTRACT,
        signedTx: "deploy-xdr",
      })),
      connectWallet: vi.fn(
        async (opts?: { getContractId?: (keyId: string) => Promise<string | undefined> }) => {
          // The connector resolves the contract id through the backend lookup.
          await opts?.getContractId?.("key123");
          return { keyIdBase64: "key123", contractId: CONTRACT };
        },
      ),
      sign: vi.fn(async (tx: unknown) => tx),
      wallet: undefined,
    } as unknown as PasskeyKitLike;
  }

  function fakeSac() {
    const transfer = vi.fn(async () => "transfer-xdr");
    return {
      getSACClient: vi.fn(() => ({ transfer })),
      _transfer: transfer,
    };
  }

  function build() {
    const calls: string[] = [];
    const kit = fakeKit();
    const sac = fakeSac();
    const wallet = createVellarWallet({
      network: "testnet",
      appName: "Test App",
      kit,
      backend: createHttpWalletBackend(API_URL, makeMockServer({ calls })),
      sac,
      isValidAddress: () => true,
    });
    return { wallet, kit, sac, calls, server: makeMockServer({ calls }) };
  }

  it("initializes the wallet through the mock backend and sets the session", async () => {
    const { wallet, kit, calls } = build();

    const session = await wallet.connect();

    expect(session.accountId).toBe(CONTRACT);
    expect(session.network).toBe("testnet");
    expect(wallet.session).toBe(session);
    // The connector resolved the contract id via the backend's /wallet/connect.
    expect(kit.connectWallet).toHaveBeenCalledOnce();
    expect(calls).toContain("POST /wallet/connect");
  });

  it("fetches a balance from the backend after wallet initialization", async () => {
    const { wallet, server, calls } = build();

    const session = await wallet.connect();
    const res = await server(`${API_URL}/wallet/balance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contractId: session.accountId }),
    });

    expect(res.ok).toBe(true);
    const data = (await res.json()) as { contractId: string; balances: { symbol: string }[] };
    expect(data.contractId).toBe(CONTRACT);
    expect(data.balances).toHaveLength(1);
    expect(data.balances[0]!.symbol).toBe("XLM");
    // Both the init call and the balance fetch went through the harness server.
    expect(calls).toContain("POST /wallet/balance");
  });

  it("submits a payment through the mock backend after initialization", async () => {
    const { wallet, kit, sac, calls } = build();

    await wallet.connect();
    const result = await wallet.pay({ to: "CDEST", amount: 5n, token });

    expect(sac.getSACClient).toHaveBeenCalledWith("CTOKEN");
    expect(kit.sign).toHaveBeenCalledOnce();
    expect(calls).toContain("POST /wallet/submit");
    expect(result.hash).toBe("txhash-submit");
  });
});

describe("wallet backend contract — error responses", () => {
  function makeContractServer(overrides: {
    create?: (body: Record<string, unknown>) => { status: number; body: unknown };
    connect?: (body: Record<string, unknown>) => { status: number; body: unknown };
    submit?: (body: Record<string, unknown>) => { status: number; body: unknown };
  }): MockFetch {
    return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const path = new URL(String(input)).pathname;
      let body: Record<string, unknown> = {};
      if (init?.body) body = JSON.parse(String(init.body));
      const json = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), {
          status,
          headers: { "content-type": "application/json" },
        });

      if (path === "/wallet/create" && overrides.create) {
        const r = overrides.create(body);
        return json(r.body, r.status);
      }
      if (path === "/wallet/connect" && overrides.connect) {
        const r = overrides.connect(body);
        return json(r.body, r.status);
      }
      if (path === "/wallet/submit" && overrides.submit) {
        const r = overrides.submit(body);
        return json(r.body, r.status);
      }
      // Default success responses
      if (path === "/wallet/create") return json({ sessionId: "sess-create" });
      if (path === "/wallet/connect")
        return json({ contractId: CONTRACT, sessionId: "sess-connect" });
      if (path === "/wallet/submit") return json({ hash: "txhash-submit" });
      return new Response(null, { status: 404 });
    }) as MockFetch;
  }

  it("submit returns WalletApiError with status and code on validation failure", async () => {
    const server = makeContractServer({
      submit: () => ({ status: 422, body: { error: "invalid_xdr", message: "Malformed XDR" } }),
    });
    const backend = createHttpWalletBackend(API_URL, server);
    const err = await backend
      .submitTransaction({ signedXdr: "bad", network: "testnet" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("WalletApiError");
    expect(err.status).toBe(422);
    expect(err.code).toBe("invalid_xdr");
  });

  it("connect returns undefined for unknown keyId (404)", async () => {
    const server = makeContractServer({
      connect: () => ({ status: 404, body: { error: "not_found" } }),
    });
    const backend = createHttpWalletBackend(API_URL, server);
    const result = await backend.lookupContractId({
      keyId: "unknown-key",
      network: "testnet",
    });
    expect(result).toBeUndefined();
  });

  it("create returns WalletApiError on upstream failure", async () => {
    const server = makeContractServer({
      create: () => ({
        status: 502,
        body: { error: "upstream_error", message: "Relayer unavailable" },
      }),
    });
    const backend = createHttpWalletBackend(API_URL, server);
    const err = await backend
      .submitWalletCreation({
        keyId: "key123",
        contractId: CONTRACT,
        network: "testnet",
        signedTx: "deploy-xdr",
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("WalletApiError");
    expect(err.status).toBe(502);
  });

  it("submit returns WalletApiError on upstream failure", async () => {
    const server = makeContractServer({
      submit: () => ({
        status: 500,
        body: { error: "internal_error", message: "Unexpected failure" },
      }),
    });
    const backend = createHttpWalletBackend(API_URL, server);
    const err = await backend
      .submitTransaction({ signedXdr: "xdr", network: "testnet" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("WalletApiError");
    expect(err.status).toBe(500);
  });

  it("connect returns WalletApiError on non-404 failure", async () => {
    const server = makeContractServer({
      connect: () => ({
        status: 503,
        body: { error: "service_unavailable" },
      }),
    });
    const backend = createHttpWalletBackend(API_URL, server);
    const err = await backend
      .lookupContractId({ keyId: "key123", network: "testnet" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("WalletApiError");
    expect(err.status).toBe(503);
  });
});
