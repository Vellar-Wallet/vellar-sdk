/**
 * Reference implementation for issue #265:
 * Add integration harness for client.ts plus http-backend.ts.
 *
 * Wires `createVellarWallet` (client.ts) to a mock backend server via
 * `createHttpWalletBackend` (http-backend.ts). The "server" is a path-routing
 * mock `fetch` so the client's full init / submission / balance path runs over
 * the exact transport `createHttpWalletBackend` uses in production — without any
 * Node types (the SDK stays browser-safe) or external network.
 *
 * This module is intentionally self-contained (only type-only imports from
 * `../../src/`) so it can be used by contributors without editing files outside
 * `contrib/`. A maintainer can wire this into the CI pipeline or run it locally.
 */

import type { PasskeyKitLike } from "../../src/passkeykit-connector";
import { createVellarWallet } from "../../src/client";
import { createHttpWalletBackend } from "../../src/http-backend";

/** Base URL for the mock backend used in tests. */
const API_URL = "https://mock-backend.test";

/** A contract ID used across the harness tests. */
const CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

/** A token info for XLM. */
const token = { contractId: "CTOKEN", symbol: "XLM", decimals: 7 };

/** A path-routing mock "server" standing in for the gateway base URL. */
function makeMockServer(store: { calls: string[] }) {
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
  return server;
}

/** A fake passkey kit for testing. */
function fakeKit() {
  return {
    createWallet: async () => ({
      keyIdBase64: "key123",
      contractId: CONTRACT,
      signedTx: "deploy-xdr",
    }),
    connectWallet: async (opts?: {
      getContractId?: (keyId: string) => Promise<string | undefined>;
    }) => {
      await opts?.getContractId?.("key123");
      return { keyIdBase64: "key123", contractId: CONTRACT };
    },
    sign: async (tx: unknown) => tx,
    wallet: undefined,
  } as unknown as PasskeyKitLike;
}

/** A fake SAC client for testing. */
function fakeSac() {
  const transfer = async () => "transfer-xdr";
  return {
    getSACClient: async () => ({ transfer }),
    _transfer: transfer,
  };
}

/** Build the harness with a fresh mock server and call store. */
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
  return { wallet, kit, sac, calls };
}

export { API_URL, CONTRACT, token, build, fakeKit, fakeSac, makeMockServer };