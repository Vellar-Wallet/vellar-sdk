import { describe, expect, it, vi } from "vitest";
import { createHttpWalletBackend } from "./http-backend";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("http-backend — correlation id propagation", () => {
  it("includes x-correlation-id header when submitting wallet creation", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ sessionId: "s1" }));
    const backend = createHttpWalletBackend("https://api.vellar.test", fetchMock);

    await backend.submitWalletCreation({
      keyId: "k1",
      contractId: "C1",
      network: "testnet",
      signedTx: "signed-xdr",
      correlationId: "trace-create-123",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.vellar.test/wallet/create");
    expect(init?.headers).toEqual({
      "content-type": "application/json",
      "x-correlation-id": "trace-create-123",
    });
  });

  it("includes x-correlation-id header when looking up contract id", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ contractId: "C1", sessionId: "s1" }),
    );
    const backend = createHttpWalletBackend("https://api.vellar.test", fetchMock);

    await backend.lookupContractId({
      keyId: "k1",
      network: "testnet",
      correlationId: "trace-connect-456",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.vellar.test/wallet/connect");
    expect(init?.headers).toEqual({
      "content-type": "application/json",
      "x-correlation-id": "trace-connect-456",
    });
  });

  it("includes x-correlation-id header when submitting transaction", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ hash: "txhash123" }));
    const backend = createHttpWalletBackend("https://api.vellar.test", fetchMock);

    await backend.submitTransaction({
      signedXdr: "xdr-data",
      network: "testnet",
      correlationId: "trace-submit-789",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.vellar.test/wallet/submit");
    expect(init?.headers).toEqual({
      "content-type": "application/json",
      "x-correlation-id": "trace-submit-789",
    });
  });

  it("uses options.correlationId when no per-call correlationId is given", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ hash: "txhash123" }));
    const backend = createHttpWalletBackend("https://api.vellar.test", fetchMock, {
      correlationId: () => "global-trace-001",
    });

    await backend.submitTransaction({
      signedXdr: "xdr-data",
      network: "testnet",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.headers).toEqual({
      "content-type": "application/json",
      "x-correlation-id": "global-trace-001",
    });
  });

  it("omits x-correlation-id header when none is provided", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ hash: "txhash123" }));
    const backend = createHttpWalletBackend("https://api.vellar.test", fetchMock);

    await backend.submitTransaction({
      signedXdr: "xdr-data",
      network: "testnet",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.headers).toEqual({
      "content-type": "application/json",
    });
  });
});
