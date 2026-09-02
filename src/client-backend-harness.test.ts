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
