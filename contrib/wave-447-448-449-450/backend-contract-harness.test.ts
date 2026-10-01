import { describe, expect, it } from "vitest";
import { walletBackendContractTests } from "./backend-contract-harness";
import { createHttpWalletBackend, WalletApiError } from "../../src/http-backend";

// Run the wallet backend contract suite against the SDK's own
// createHttpWalletBackend wired to a hermetic mock server.
// Also includes error contract tests extending the existing harness.

const API_URL = "https://mock-backend.test";
const CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

function makeMockServer(): typeof fetch {
  const knownKeys = new Set<string>();

  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const path = new URL(String(input)).pathname;
    let body: Record<string, unknown> = {};
    if (init?.body) body = JSON.parse(String(init.body));
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json" },
      });

    if (path === "/wallet/create") {
      const keyId = body.keyId as string;
      if (keyId) knownKeys.add(keyId);
      return json({ sessionId: `sess-${keyId ?? "create"}` });
    }
    if (path === "/wallet/connect") {
      const keyId = body.keyId as string;
      if (!knownKeys.has(keyId)) {
        return json({ error: "not_found", message: "Unknown keyId" }, 404);
      }
      return json({ contractId: CONTRACT, sessionId: `sess-${keyId}` });
    }
    if (path === "/wallet/submit") {
      const xdr = body.signedXdr as string;
      if (!xdr || xdr === "INVALID") {
        return json({ error: "invalid_xdr", message: "Malformed XDR" }, 422);
      }
      return json({ hash: `hash-${Date.now()}` });
    }
    return json({ error: "not_found" }, 404);
  }) as typeof fetch;
}

walletBackendContractTests(() => createHttpWalletBackend(API_URL, makeMockServer()));

describe("wallet backend error contract (#450)", () => {
  it("submit returns WalletApiError with status and code on validation failure", async () => {
    const server = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const path = new URL(String(input)).pathname;
      if (path === "/wallet/submit") {
        return new Response(
          JSON.stringify({ error: "invalid_xdr", message: "Malformed XDR" }),
          { status: 422, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;
    const backend = createHttpWalletBackend(API_URL, server);
    const err = await backend
      .submitTransaction({ signedXdr: "bad", network: "testnet" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(WalletApiError);
    expect(err.name).toBe("WalletApiError");
    expect(err.status).toBe(422);
    expect(err.code).toBe("invalid_xdr");
  });

  it("connect returns undefined for unknown keyId (404)", async () => {
    const server = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const path = new URL(String(input)).pathname;
      if (path === "/wallet/connect") {
        return new Response(
          JSON.stringify({ error: "not_found" }),
          { status: 404, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;
    const backend = createHttpWalletBackend(API_URL, server);
    const result = await backend.lookupContractId({
      keyId: "unknown-key",
      network: "testnet",
    });
    expect(result).toBeUndefined();
  });

  it("create returns WalletApiError on upstream failure", async () => {
    const server = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const path = new URL(String(input)).pathname;
      if (path === "/wallet/create") {
        return new Response(
          JSON.stringify({ error: "upstream_error", message: "Relayer unavailable" }),
          { status: 502, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;
    const backend = createHttpWalletBackend(API_URL, server);
    const err = await backend
      .submitWalletCreation({
        keyId: "key123",
        contractId: CONTRACT,
        network: "testnet",
        signedTx: "deploy-xdr",
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(WalletApiError);
    expect(err.name).toBe("WalletApiError");
    expect(err.status).toBe(502);
  });

  it("submit returns WalletApiError on upstream failure", async () => {
    const server = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const path = new URL(String(input)).pathname;
      if (path === "/wallet/submit") {
        return new Response(
          JSON.stringify({ error: "internal_error", message: "Unexpected failure" }),
          { status: 500, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;
    const backend = createHttpWalletBackend(API_URL, server);
    const err = await backend
      .submitTransaction({ signedXdr: "xdr", network: "testnet" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(WalletApiError);
    expect(err.name).toBe("WalletApiError");
    expect(err.status).toBe(500);
  });

  it("connect returns WalletApiError on non-404 failure", async () => {
    const server = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const path = new URL(String(input)).pathname;
      if (path === "/wallet/connect") {
        return new Response(
          JSON.stringify({ error: "service_unavailable" }),
          { status: 503, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;
    const backend = createHttpWalletBackend(API_URL, server);
    const err = await backend
      .lookupContractId({ keyId: "key123", network: "testnet" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(WalletApiError);
    expect(err.name).toBe("WalletApiError");
    expect(err.status).toBe(503);
  });
});