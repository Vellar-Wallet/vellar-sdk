import { describe, it, expect, vi } from "vitest";
import { createHttpWalletBackend, WalletApiError } from "../../src/http-backend";

describe("http-backend tests (#404)", () => {
  const apiUrl = "https://gateway.example.com";

  it("submits wallet creation successfully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ sessionId: "sess-123" }),
    });

    const backend = createHttpWalletBackend(apiUrl, mockFetch as any);
    const result = await backend.submitWalletCreation({
      keyId: "key-1",
      contractId: "C12345",
      network: "testnet",
      signedTx: "AAAA...",
    });

    expect(result).toEqual({ sessionId: "sess-123" });
    expect(mockFetch).toHaveBeenCalledWith("https://gateway.example.com/wallet/create", {
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

  it("throws WalletApiError when wallet creation fails", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "INVALID_KEY", message: "Invalid key identifier" }),
    });

    const backend = createHttpWalletBackend(apiUrl, mockFetch as any);

    await expect(
      backend.submitWalletCreation({
        keyId: "bad-key",
        contractId: "C12345",
        network: "testnet",
        signedTx: "AAAA...",
      })
    ).rejects.toThrow(WalletApiError);
  });

  it("looks up contract ID successfully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ contractId: "C999", sessionId: "sess-456" }),
    });

    const backend = createHttpWalletBackend(apiUrl, mockFetch as any);
    const result = await backend.lookupContractId({ keyId: "key-2", network: "mainnet" });

    expect(result).toEqual({ contractId: "C999", sessionId: "sess-456" });
  });

  it("returns undefined on 404 when looking up contract ID", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "NOT_FOUND" }),
    });

    const backend = createHttpWalletBackend(apiUrl, mockFetch as any);
    const result = await backend.lookupContractId({ keyId: "nonexistent", network: "testnet" });

    expect(result).toBeUndefined();
  });

  it("submits transaction successfully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ hash: "txhash123456" }),
    });

    const backend = createHttpWalletBackend(apiUrl, mockFetch as any);
    const result = await backend.submitTransaction({ signedXdr: "AAAA...", network: "testnet" });

    expect(result).toEqual({ hash: "txhash123456" });
  });
});
