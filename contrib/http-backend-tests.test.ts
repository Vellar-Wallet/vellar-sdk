import { describe, it, expect, vi } from "vitest";
import { createHttpWalletBackend, WalletApiError } from "../src/http-backend";

// Direct unit tests for src/http-backend.ts — the SDK's network boundary to the
// consumer's own gateway. It is exercised indirectly today via
// client-backend-harness.test.ts, but toApiError has real branching that
// deserves its own coverage: a JSON body with a message, a JSON body with only
// an error code, a non-JSON body (the catch fallthrough), and the fallback
// "Wallet API request failed (<status>)" message when the body has neither.

const apiUrl = "https://gateway.example.com";

function jsonResponse(status: number, body: unknown, ok = status >= 200 && status < 300) {
  return { ok, status, json: async () => body } as unknown as Response;
}

function nonJsonResponse(status: number, ok = false) {
  return {
    ok,
    status,
    json: async () => {
      throw new SyntaxError("Unexpected token in JSON");
    },
  } as unknown as Response;
}

describe("http-backend: toApiError branches", () => {
  it("uses the JSON body's message when present", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: "INVALID_KEY", message: "Invalid key identifier" }));
    const backend = createHttpWalletBackend(apiUrl, fetchImpl as unknown as typeof fetch);

    await expect(
      backend.submitTransaction({ signedXdr: "AAAA", network: "testnet" }),
    ).rejects.toMatchObject({ message: "Invalid key identifier" });
  });

  it("falls back to the JSON body's error code when message is absent", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(422, { error: "UNSUPPORTED_NETWORK" }));
    const backend = createHttpWalletBackend(apiUrl, fetchImpl as unknown as typeof fetch);

    await expect(
      backend.submitTransaction({ signedXdr: "AAAA", network: "testnet" }),
    ).rejects.toMatchObject({ message: "UNSUPPORTED_NETWORK" });
  });

  it("falls back to a generic message when the error body is non-JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(nonJsonResponse(500));
    const backend = createHttpWalletBackend(apiUrl, fetchImpl as unknown as typeof fetch);

    await expect(
      backend.submitTransaction({ signedXdr: "AAAA", network: "testnet" }),
    ).rejects.toMatchObject({ message: "Wallet API request failed (500)" });
  });

  it("falls back to a generic message when the JSON body has neither message nor error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(503, {}));
    const backend = createHttpWalletBackend(apiUrl, fetchImpl as unknown as typeof fetch);

    await expect(
      backend.submitTransaction({ signedXdr: "AAAA", network: "testnet" }),
    ).rejects.toMatchObject({ message: "Wallet API request failed (503)" });
  });
});

describe("http-backend: WalletApiError.status and .code", () => {
  it("populates status from the response and code from the JSON error field", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, { error: "ALREADY_EXISTS", message: "Wallet already exists" }));
    const backend = createHttpWalletBackend(apiUrl, fetchImpl as unknown as typeof fetch);

    let caught: unknown;
    try {
      await backend.submitWalletCreation({
        keyId: "key-1",
        contractId: "C12345",
        network: "testnet",
        signedTx: "AAAA...",
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(WalletApiError);
    const err = caught as WalletApiError;
    expect(err.status).toBe(409);
    expect(err.code).toBe("ALREADY_EXISTS");
    expect(err.name).toBe("WalletApiError");
  });

  it("leaves code undefined when the body carries no error field", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(nonJsonResponse(502));
    const backend = createHttpWalletBackend(apiUrl, fetchImpl as unknown as typeof fetch);

    let caught: unknown;
    try {
      await backend.submitTransaction({ signedXdr: "AAAA", network: "testnet" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(WalletApiError);
    const err = caught as WalletApiError;
    expect(err.status).toBe(502);
    expect(err.code).toBeUndefined();
  });
});

describe("http-backend: documented endpoints post the expected shape", () => {
  it("POSTs /wallet/create with keyId, contractId, network, and the XDR'd signedTx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { sessionId: "sess-123" }));
    const backend = createHttpWalletBackend(apiUrl, fetchImpl as unknown as typeof fetch);

    const result = await backend.submitWalletCreation({
      keyId: "key-1",
      contractId: "C12345",
      network: "testnet",
      signedTx: "AAAA...",
    });

    expect(result).toEqual({ sessionId: "sess-123" });
    expect(fetchImpl).toHaveBeenCalledWith(`${apiUrl}/wallet/create`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        keyId: "key-1",
        contractId: "C12345",
        network: "testnet",
        signedTx: "AAAA...",
      }),
    });
  });

  it("POSTs /wallet/connect with keyId and network, and returns undefined on 404", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { error: "NOT_FOUND" }, false));
    const backend = createHttpWalletBackend(apiUrl, fetchImpl as unknown as typeof fetch);

    const result = await backend.lookupContractId({ keyId: "key-2", network: "mainnet" });

    expect(result).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(`${apiUrl}/wallet/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keyId: "key-2", network: "mainnet" }),
    });
  });

  it("POSTs /wallet/connect and returns the contract lookup on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { contractId: "C999", sessionId: "sess-456" }));
    const backend = createHttpWalletBackend(apiUrl, fetchImpl as unknown as typeof fetch);

    const result = await backend.lookupContractId({ keyId: "key-2", network: "testnet" });

    expect(result).toEqual({ contractId: "C999", sessionId: "sess-456" });
  });

  it("POSTs /wallet/submit with signedXdr and network", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { hash: "txhash123456" }));
    const backend = createHttpWalletBackend(apiUrl, fetchImpl as unknown as typeof fetch);

    const result = await backend.submitTransaction({ signedXdr: "AAAA...", network: "testnet" });

    expect(result).toEqual({ hash: "txhash123456" });
    expect(fetchImpl).toHaveBeenCalledWith(`${apiUrl}/wallet/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signedXdr: "AAAA...", network: "testnet" }),
    });
  });
});
