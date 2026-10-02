import { describe, expect, it, vi } from "vitest";
import {
  createHttpWalletBackend,
  WalletApiAbortError,
  WalletApiError,
  WalletApiTimeoutError,
} from "./http-backend";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function waitForAbort(signal: AbortSignal): Promise<Response> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("fetch aborted")), { once: true });
  });
}

describe("createHttpWalletBackend request controls", () => {
  it("rejects with a typed error when a request times out", async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) =>
      waitForAbort(init?.signal as AbortSignal),
    );
    const backend = createHttpWalletBackend("https://api.test", {
      fetchImpl,
      timeoutMs: 5,
      maxRetries: 0,
    });

    await expect(
      backend.submitTransaction({ signedXdr: "AAAA", network: "testnet" }),
    ).rejects.toBeInstanceOf(WalletApiTimeoutError);
  });

  it("cancels an in-flight request when its signal is aborted", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) =>
      waitForAbort(init?.signal as AbortSignal),
    );
    const backend = createHttpWalletBackend("https://api.test", {
      fetchImpl,
      timeoutMs: 1_000,
    });
    const request = backend.lookupContractId({
      keyId: "key-1",
      network: "testnet",
      signal: controller.signal,
    });
    controller.abort();

    await expect(request).rejects.toBeInstanceOf(WalletApiAbortError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("retries an activity read and succeeds", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ error: "busy" }, 503))
      .mockResolvedValueOnce(json({ transactions: [], hasMore: false, nextCursor: null }));
    const backend = createHttpWalletBackend("https://api.test", {
      fetchImpl,
      retryDelayMs: 0,
    });

    await expect(
      backend.listActivity({
        accountId: "CWALLET",
        sessionId: "session-1",
        network: "testnet",
      }),
    ).resolves.toEqual({ items: [], hasMore: false });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry wallet connect because it creates a server session", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ error: "busy" }, 503));
    const backend = createHttpWalletBackend("https://api.test", {
      fetchImpl,
      retryDelayMs: 0,
    });

    await expect(
      backend.lookupContractId({ keyId: "key-1", network: "testnet" }),
    ).rejects.toBeInstanceOf(WalletApiError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("never retries a transaction submission", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ error: "busy" }, 503));
    const backend = createHttpWalletBackend("https://api.test", {
      fetchImpl,
      retryDelayMs: 0,
    });

    await expect(
      backend.submitTransaction({ signedXdr: "AAAA", network: "testnet" }),
    ).rejects.toBeInstanceOf(WalletApiError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("maps populated transaction history to the typed activity shape", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        transactions: [
          {
            id: "event-1",
            type: "payment.sent",
            at: "2026-09-30T12:00:00.000Z",
            data: {
              to: "GRECIPIENT",
              amount: "2500000",
              token: { contractId: "CTOKEN", symbol: "USDC", decimals: 7 },
              txHash: "tx-abc",
            },
          },
        ],
        hasMore: false,
        nextCursor: null,
      }),
    );
    const backend = createHttpWalletBackend("https://api.test", { fetchImpl });

    await expect(
      backend.listActivity({
        accountId: "CWALLET",
        sessionId: "session-1",
        network: "testnet",
      }),
    ).resolves.toEqual({
      items: [
        {
          id: "event-1",
          type: "payment.sent",
          counterparty: "GRECIPIENT",
          amount: "2500000",
          token: { contractId: "CTOKEN", symbol: "USDC", decimals: 7 },
          transactionHash: "tx-abc",
          timestamp: "2026-09-30T12:00:00.000Z",
        },
      ],
      hasMore: false,
    });
  });

  it("forwards cursor pagination and returns the next cursor", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({ transactions: [], hasMore: true, nextCursor: "cursor-next" }),
    );
    const backend = createHttpWalletBackend("https://api.test", { fetchImpl });

    await expect(
      backend.listActivity({
        accountId: "CWALLET",
        sessionId: "session-1",
        network: "testnet",
        limit: 10,
        cursor: "cursor-current",
      }),
    ).resolves.toEqual({ items: [], hasMore: true, nextCursor: "cursor-next" });
    const requestUrl = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(requestUrl.pathname).toBe("/wallet/transactions");
    expect(requestUrl.searchParams.get("contractId")).toBe("CWALLET");
    expect(requestUrl.searchParams.get("limit")).toBe("10");
    expect(requestUrl.searchParams.get("after")).toBe("cursor-current");
    expect(fetchImpl.mock.calls[0][1]?.headers).toEqual({
      authorization: "Bearer session-1",
    });
  });

  it("returns an empty page for an account with no activity", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({ transactions: [], hasMore: false, nextCursor: null }),
    );
    const backend = createHttpWalletBackend("https://api.test", { fetchImpl });

    await expect(
      backend.listActivity({
        accountId: "CWALLET",
        sessionId: "session-1",
        network: "testnet",
      }),
    ).resolves.toEqual({ items: [], hasMore: false });
  });
});