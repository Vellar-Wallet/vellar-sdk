import { afterAll, beforeAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { createVellarWallet } from "./client";
import { createHttpWalletBackend } from "./http-backend";
import type { PasskeyKitLike } from "./passkeykit-connector";

// Integration harness: wires `client.ts` (createVellarWallet) to a mock backend
// server via `http-backend.ts` (createHttpWalletBackend). It spins up a real
// local HTTP server implementing the gateway endpoints the SDK speaks, so the
// client's full init + submission path is exercised end to end against the
// transport it would use in production — without any external network.
//
// Run as part of `npm test` (it is hermetic: a loopback server, no chain, no
// external service). See CONTRIBUTING.md for local-run instructions.

const CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

interface MockGateway {
  url: string;
  server: Server;
  /** Every request path the harness observed, in order. */
  calls: string[];
}

function startMockGateway(): Promise<MockGateway> {
  return new Promise((resolve) => {
    const calls: string[] = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = chunks.length ? JSON.parse(chunks.join("")) : {};
        const url = req.url ?? "";
        calls.push(`${req.method} ${url}`);

        if (url === "/wallet/create") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ sessionId: "sess-create" }));
        } else if (url === "/wallet/connect") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ contractId: CONTRACT, sessionId: "sess-connect" }));
        } else if (url === "/wallet/submit") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ hash: "txhash-submit" }));
        } else if (url === "/wallet/balance") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              contractId: body.contractId,
              balances: [{ symbol: "XLM", amount: "10000000" }],
            }),
          );
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, server, calls });
    });
  });
}

const token = { contractId: "CTOKEN", symbol: "XLM", decimals: 7 };

describe("client.ts ↔ http-backend.ts integration harness", () => {
  let gateway: MockGateway;

  beforeAll(async () => {
    gateway = await startMockGateway();
  });

  afterAll(() => {
    gateway.server.close();
  });

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
      connectWallet: vi.fn(async (opts?: { getContractId?: (keyId: string) => Promise<string | undefined> }) => {
        // The connector resolves the contract id through the backend lookup.
        await opts?.getContractId?.("key123");
        return { keyIdBase64: "key123", contractId: CONTRACT };
      }),
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
    const kit = fakeKit();
    const sac = fakeSac();
    const wallet = createVellarWallet({
      network: "testnet",
      appName: "Test App",
      kit,
      backend: createHttpWalletBackend(gateway.url),
      sac,
      isValidAddress: () => true,
    });
    return { wallet, kit, sac };
  }

  it("initializes the wallet through the mock backend and sets the session", async () => {
    const { wallet, kit } = build();

    const session = await wallet.connect();

    expect(session.accountId).toBe(CONTRACT);
    expect(session.network).toBe("testnet");
    expect(wallet.session).toBe(session);
    // The connector resolved the contract id via the backend's /wallet/connect.
    expect(kit.connectWallet).toHaveBeenCalledOnce();
    expect(gateway.calls).toContain("POST /wallet/connect");
  });

  it("fetches a balance from the backend after wallet initialization", async () => {
    const { wallet } = build();

    const session = await wallet.connect();
    const res = await fetch(`${gateway.url}/wallet/balance`, {
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
    expect(gateway.calls).toContain("POST /wallet/balance");
  });

  it("submits a payment through the mock backend after initialization", async () => {
    const { wallet, kit, sac } = build();

    await wallet.connect();
    const result = await wallet.pay({ to: "CDEST", amount: 5n, token });

    expect(sac.getSACClient).toHaveBeenCalledWith("CTOKEN");
    expect(kit.sign).toHaveBeenCalledOnce();
    expect(gateway.calls).toContain("POST /wallet/submit");
    expect(result.hash).toBe("txhash-submit");
  });
});
