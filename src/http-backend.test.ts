import { describe, expect, it, vi } from "vitest";
import { createHttpWalletBackend, WalletApiError } from "./http-backend";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(text: string, status = 500): Response {
  return new Response(text, {
    status,
    headers: { "content-type": "text/html" },
  });
}

describe("createHttpWalletBackend", () => {
  const apiUrl = "https://gateway.example.com";

  describe("submitWalletCreation", () => {
    it("posts to /wallet/create with correct URL, method, headers, and body", async () => {
      const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ sessionId: "sess-123" }));
      const backend = createHttpWalletBackend(apiUrl, fetchMock);

      const res = await backend.submitWalletCreation({
        keyId: "key-1",
        contractId: "C123456",
        network: "testnet",
        signedTx: "signed-xdr-data",
      });

      expect(res).toEqual({ sessionId: "sess-123" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://gateway.example.com/wallet/create");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "content-type": "application/json" });
      expect(JSON.parse(init?.body as string)).toEqual({
        keyId: "key-1",
        contractId: "C123456",
        network: "testnet",
        signedTx: "signed-xdr-data",
      });
    });

    it("throws WalletApiError with status and code on non-2xx response", async () => {
      const fetchMock = vi.fn<typeof fetch>(async () =>
        jsonResponse({ error: "invalid_key", message: "Key already registered" }, 400),
      );
      const backend = createHttpWalletBackend(apiUrl, fetchMock);

      await expect(
        backend.submitWalletCreation({
          keyId: "key-1",
          contractId: "C123456",
          network: "testnet",
          signedTx: "signed-xdr-data",
        }),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(WalletApiError);
        const apiErr = err as WalletApiError;
        expect(apiErr.status).toBe(400);
        expect(apiErr.code).toBe("invalid_key");
        expect(apiErr.message).toBe("Key already registered");
        return true;
      });
    });
  });

  describe("lookupContractId", () => {
    it("posts to /wallet/connect and returns contractId and sessionId on 200", async () => {
      const fetchMock = vi.fn<typeof fetch>(async () =>
        jsonResponse({ contractId: "C7890", sessionId: "sess-456" }),
      );
      const backend = createHttpWalletBackend(apiUrl, fetchMock);

      const res = await backend.lookupContractId({ keyId: "key-2", network: "testnet" });

      expect(res).toEqual({ contractId: "C7890", sessionId: "sess-456" });
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://gateway.example.com/wallet/connect");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init?.body as string)).toEqual({ keyId: "key-2", network: "testnet" });
    });

    it("returns undefined on 404 status without throwing", async () => {
      const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ error: "not_found" }, 404));
      const backend = createHttpWalletBackend(apiUrl, fetchMock);

      const res = await backend.lookupContractId({ keyId: "key-missing", network: "testnet" });
      expect(res).toBeUndefined();
    });

    it("throws WalletApiError on 500 error response", async () => {
      const fetchMock = vi.fn<typeof fetch>(async () =>
        jsonResponse({ error: "internal_error", message: "Database connection failed" }, 500),
      );
      const backend = createHttpWalletBackend(apiUrl, fetchMock);

      await expect(
        backend.lookupContractId({ keyId: "key-2", network: "testnet" }),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(WalletApiError);
        const apiErr = err as WalletApiError;
        expect(apiErr.status).toBe(500);
        expect(apiErr.code).toBe("internal_error");
        expect(apiErr.message).toBe("Database connection failed");
        return true;
      });
    });
  });

  describe("submitTransaction", () => {
    it("posts to /wallet/submit and returns transaction hash on 200", async () => {
      const fetchMock = vi.fn<typeof fetch>(async () =>
        jsonResponse({ hash: "0x1234567890abcdef" }),
      );
      const backend = createHttpWalletBackend(apiUrl, fetchMock);

      const res = await backend.submitTransaction({ signedXdr: "AAAA...", network: "testnet" });

      expect(res).toEqual({ hash: "0x1234567890abcdef" });
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("https://gateway.example.com/wallet/submit");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init?.body as string)).toEqual({
        signedXdr: "AAAA...",
        network: "testnet",
      });
    });
  });

  describe("error handling edge cases", () => {
    it("handles network-level fetch rejection distinctly", async () => {
      const fetchMock = vi.fn<typeof fetch>(async () => {
        throw new TypeError("Failed to fetch (network error)");
      });
      const backend = createHttpWalletBackend(apiUrl, fetchMock);

      await expect(
        backend.submitTransaction({ signedXdr: "AAAA...", network: "testnet" }),
      ).rejects.toThrow("Failed to fetch (network error)");
    });

    it("handles non-JSON error response body (e.g. HTML 502 page) without JSON parse crash", async () => {
      const fetchMock = vi.fn<typeof fetch>(async () =>
        textResponse("<html><body>502 Bad Gateway</body></html>", 502),
      );
      const backend = createHttpWalletBackend(apiUrl, fetchMock);

      await expect(
        backend.submitTransaction({ signedXdr: "AAAA...", network: "testnet" }),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(WalletApiError);
        const apiErr = err as WalletApiError;
        expect(apiErr.status).toBe(502);
        expect(apiErr.code).toBeUndefined();
        expect(apiErr.message).toBe("Wallet API request failed (502)");
        return true;
      });
    });
  });
});
