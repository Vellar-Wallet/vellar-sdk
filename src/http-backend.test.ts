import { describe, expect, it, vi } from "vitest";
import { createHttpWalletBackend, WalletApiError } from "./http-backend";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createHttpWalletBackend", () => {
  it("submits transactions and returns the hash", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ hash: "txhash" }));
    const backend = createHttpWalletBackend("https://api.test", fetchMock);
    const result = await backend.submitTransaction({ signedXdr: "xdr", network: "testnet" });
    expect(result.hash).toBe("txhash");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.test/wallet/submit");
  });

  it("returns undefined on a 404 lookup (no wallet for this keyId)", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({}, 404));
    const backend = createHttpWalletBackend("https://api.test", fetchMock);
    await expect(
      backend.lookupContractId({ keyId: "k1", network: "testnet" }),
    ).resolves.toBeUndefined();
  });

  it("throws a typed WalletApiError on a non-2xx response", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ error: "invalid_signature" }, 422),
    );
    const backend = createHttpWalletBackend("https://api.test", fetchMock);
    await expect(
      backend.submitTransaction({ signedXdr: "xdr", network: "testnet" }),
    ).rejects.toMatchObject({ name: "WalletApiError", status: 422, code: "invalid_signature" });
  });

  it("wraps a raw fetch network failure as a typed WalletApiError, status 0", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    const backend = createHttpWalletBackend("https://api.test", fetchMock);
    await expect(
      backend.submitTransaction({ signedXdr: "xdr", network: "testnet" }),
    ).rejects.toBeInstanceOf(WalletApiError);
    await expect(
      backend.submitTransaction({ signedXdr: "xdr", network: "testnet" }),
    ).rejects.toMatchObject({ status: 0 });
  });
});
