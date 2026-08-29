import { describe, expect, it, vi } from "vitest";
import { createHttpWalletBackend, WalletApiError, type RequestLog } from "./http-backend";

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createHttpWalletBackend logging hook", () => {
  const apiUrl = "https://gateway.example.com/";

  it("invokes the hook with method, url, status, and duration on success", async () => {
    const log = vi.fn<(log: RequestLog) => void>();
    const backend = createHttpWalletBackend(
      apiUrl,
      vi.fn(async () => jsonResponse(200, { sessionId: "s1" })),
      log,
    );

    await backend.submitWalletCreation({
      keyId: "k1",
      contractId: "C000",
      network: "testnet",
      signedTx: "xdr",
    });

    expect(log).toHaveBeenCalledTimes(1);
    const entry = log.mock.calls[0]![0];
    expect(entry.method).toBe("POST");
    expect(entry.url).toBe("https://gateway.example.com/wallet/create");
    expect(entry.status).toBe(200);
    expect(entry.durationMs).toBeTypeOf("number");
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("logs submitTransaction success with the right url", async () => {
    const log = vi.fn<(log: RequestLog) => void>();
    const backend = createHttpWalletBackend(
      apiUrl,
      vi.fn(async () => jsonResponse(200, { hash: "deadbeef" })),
      log,
    );

    await backend.submitTransaction({ signedXdr: "xdr", network: "testnet" });

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toMatchObject({
      method: "POST",
      url: "https://gateway.example.com/wallet/submit",
      status: 200,
    });
  });

  it("logs a failure for /wallet/create and still throws WalletApiError", async () => {
    const log = vi.fn<(log: RequestLog) => void>();
    const backend = createHttpWalletBackend(
      apiUrl,
      vi.fn(async () => jsonResponse(500, { error: "sponsor down" })),
      log,
    );

    await expect(
      backend.submitWalletCreation({
        keyId: "k1",
        contractId: "C000",
        network: "testnet",
        signedTx: "xdr",
      }),
    ).rejects.toThrow(WalletApiError);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toMatchObject({
      method: "POST",
      url: "https://gateway.example.com/wallet/create",
      status: 500,
    });
    expect(log.mock.calls[0]![0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("logs a failure for /wallet/connect (non-404) and still throws", async () => {
    const log = vi.fn<(log: RequestLog) => void>();
    const backend = createHttpWalletBackend(
      apiUrl,
      vi.fn(async () => jsonResponse(401, { message: "unauthorized" })),
      log,
    );

    await expect(
      backend.lookupContractId({ keyId: "k1", network: "testnet" }),
    ).rejects.toThrow("unauthorized");

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toMatchObject({
      url: "https://gateway.example.com/wallet/connect",
      status: 401,
    });
  });

  it("logs a failure for /wallet/submit and still throws", async () => {
    const log = vi.fn<(log: RequestLog) => void>();
    const backend = createHttpWalletBackend(
      apiUrl,
      vi.fn(async () => jsonResponse(503, { error: "busy" })),
      log,
    );

    await expect(
      backend.submitTransaction({ signedXdr: "xdr", network: "testnet" }),
    ).rejects.toThrow("busy");

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toMatchObject({
      url: "https://gateway.example.com/wallet/submit",
      status: 503,
    });
  });

  it("logs the 404 lookup edge case and returns undefined (not an error)", async () => {
    const log = vi.fn<(log: RequestLog) => void>();
    const backend = createHttpWalletBackend(
      apiUrl,
      vi.fn(async () => jsonResponse(404)),
      log,
    );

    await expect(
      backend.lookupContractId({ keyId: "nope", network: "testnet" }),
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toMatchObject({
      url: "https://gateway.example.com/wallet/connect",
      status: 404,
    });
  });

  it("is a no-op (and does not throw) when no hook is supplied", async () => {
    const backend = createHttpWalletBackend(
      apiUrl,
      vi.fn(async () => jsonResponse(500, { error: "boom" })),
    );

    await expect(
      backend.lookupContractId({ keyId: "k1", network: "testnet" }),
    ).rejects.toThrow(WalletApiError);
  });
});