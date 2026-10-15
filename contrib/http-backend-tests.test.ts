import { describe, it, expect, vi } from "vitest";
import {
  createHttpWalletBackend,
  WalletApiError,
  WalletApiTimeoutError,
} from "../src/http-backend";

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
    expect(fetchImpl).toHaveBeenCalledWith(`${apiUrl}/wallet/create`, expect.objectContaining({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        keyId: "key-1",
        contractId: "C12345",
        network: "testnet",
        signedTx: "AAAA...",
      }),
    }));
  });

  it("POSTs /wallet/connect with keyId and network, and returns undefined on 404", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, { error: "NOT_FOUND" }, false));
    const backend = createHttpWalletBackend(apiUrl, fetchImpl as unknown as typeof fetch);

    const result = await backend.lookupContractId({ keyId: "key-2", network: "mainnet" });

    expect(result).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(`${apiUrl}/wallet/connect`, expect.objectContaining({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keyId: "key-2", network: "mainnet" }),
    }));
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
    expect(fetchImpl).toHaveBeenCalledWith(`${apiUrl}/wallet/submit`, expect.objectContaining({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signedXdr: "AAAA...", network: "testnet" }),
    }));
  });
});

describe("http-backend: timeout, abort, and retries", () => {
  it("rejects a slow response with a typed timeout error", async () => {
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    );
    const backend = createHttpWalletBackend(apiUrl, {
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 5,
      maxRetries: 0,
    });

    await expect(
      backend.submitTransaction({ signedXdr: "AAAA", network: "testnet" }),
    ).rejects.toBeInstanceOf(WalletApiTimeoutError);
  });

  it("times out while reading a response body that never completes", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => new Promise<never>(() => {}),
    } as unknown as Response);
    const backend = createHttpWalletBackend(apiUrl, {
      fetchImpl,
      timeoutMs: 5,
      maxRetries: 0,
    });

    await expect(
      backend.submitTransaction({ signedXdr: "AAAA", network: "testnet" }),
    ).rejects.toBeInstanceOf(WalletApiTimeoutError);
  });

  it("cancels an in-flight request when its signal aborts", async () => {
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
    );
    const backend = createHttpWalletBackend(apiUrl, {
      fetchImpl: fetchImpl as typeof fetch,
      timeoutMs: 1_000,
    });
    const controller = new AbortController();
    const request = backend.submitTransaction({
      signedXdr: "AAAA",
      network: "testnet",
      signal: controller.signal,
    });

    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries an idempotent lookup and returns the successful response", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(503, { error: "busy" }, false))
      .mockResolvedValueOnce(jsonResponse(200, { contractId: "C1", sessionId: "s1" }));
    const backend = createHttpWalletBackend(apiUrl, {
      fetchImpl,
      maxRetries: 1,
      retryBaseDelayMs: 0,
    });

    await expect(
      backend.lookupContractId({ keyId: "key-1", network: "testnet" }),
    ).resolves.toEqual({ contractId: "C1", sessionId: "s1" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("never retries a transaction submission", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(503, { error: "busy" }, false));
    const backend = createHttpWalletBackend(apiUrl, {
      fetchImpl,
      maxRetries: 3,
      retryBaseDelayMs: 0,
    });

    await expect(
      backend.submitTransaction({ signedXdr: "AAAA", network: "testnet" }),
    ).rejects.toBeInstanceOf(WalletApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never retries wallet creation", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(503, { error: "busy" }, false));
    const backend = createHttpWalletBackend(apiUrl, {
      fetchImpl,
      maxRetries: 3,
      retryBaseDelayMs: 0,
    });

    await expect(
      backend.submitWalletCreation({
        keyId: "key-1",
        contractId: "CCONTRACT",
        network: "testnet",
        signedTx: "AAAA",
      }),
    ).rejects.toBeInstanceOf(WalletApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("http-backend: paginated wallet activity", () => {
  it("maps populated history and follows the next-page cursor", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          transactions: [
            {
              type: "payment",
              counterparty: "GDESTINATION",
              amount: "12.5000000",
              token: { symbol: "XLM", contractId: "CXLM", decimals: 7, ignored: true },
              txHash: "hash-1",
              at: "2026-10-15T10:00:00.000Z",
              ignored: "upstream-only",
            },
          ],
          hasMore: true,
          nextCursor: "opaque cursor/+",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          transactions: [{ txHash: "hash-2", at: "2026-10-14T10:00:00.000Z" }],
          hasMore: false,
          nextCursor: null,
        }),
      );
    const backend = createHttpWalletBackend(apiUrl, fetchImpl);
    const request = {
      accountId: "CCONTRACT",
      network: "testnet" as const,
      bearerSessionId: "session-secret",
      limit: 1,
    };

    const first = await backend.listActivity(request);
    expect(first).toEqual({
      entries: [
        {
          type: "payment",
          counterparty: "GDESTINATION",
          amount: "12.5000000",
          token: { symbol: "XLM", contractId: "CXLM", decimals: 7 },
          txHash: "hash-1",
          timestamp: "2026-10-15T10:00:00.000Z",
        },
      ],
      hasMore: true,
      nextCursor: "opaque cursor/+",
    });
    const second = await backend.listActivity({ ...request, after: first.nextCursor });

    expect(second).toEqual({
      entries: [
        {
          type: "tx.submitted",
          txHash: "hash-2",
          timestamp: "2026-10-14T10:00:00.000Z",
        },
      ],
      hasMore: false,
      nextCursor: undefined,
    });
    const [firstUrl, firstInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const [secondUrl, secondInit] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(new URL(firstUrl).pathname).toBe("/wallet/transactions");
    expect(new URL(firstUrl).searchParams.get("contractId")).toBe("CCONTRACT");
    expect(new URL(firstUrl).searchParams.get("limit")).toBe("1");
    expect(new URL(secondUrl).searchParams.get("after")).toBe("opaque cursor/+");
    expect(firstInit.headers).toEqual({ authorization: "Bearer session-secret" });
    expect(secondInit.headers).toEqual({ authorization: "Bearer session-secret" });
    expect(firstUrl).not.toContain("session-secret");
  });

  it("returns an empty page when the account has no activity", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(200, { transactions: [], hasMore: false, nextCursor: null }),
    );
    const backend = createHttpWalletBackend(apiUrl, fetchImpl);

    await expect(
      backend.listActivity({
        accountId: "CCONTRACT",
        network: "testnet",
        bearerSessionId: "session-secret",
      }),
    ).resolves.toEqual({ entries: [], hasMore: false, nextCursor: undefined });
  });
});
