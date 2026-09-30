import { walletBackendContractTests } from "./backend-contract-harness";
import { createHttpWalletBackend } from "./http-backend";

// Run the wallet backend contract suite against the SDK's own
// createHttpWalletBackend wired to a hermetic mock server.
// This validates that the SDK client satisfies the same contract it exports
// for integrators to test their own backends against.

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