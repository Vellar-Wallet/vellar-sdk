import { describe, expect, it, vi } from "vitest";
import {
  computeBackoffDelay,
  createRetryingPost,
  fetchWithRetry,
  isRetryableStatus,
  RequestAbortedError,
  RETRYABLE_STATUSES,
  type RetryEvent,
} from "./http-retry";
import { createRetryingWalletBackend, WalletApiError } from "./retrying-wallet-backend";

/** Never actually wait in tests — assert on the delays instead. */
const noSleep = () => Promise.resolve();
/** Deterministic RNG so jitter is reproducible. */
const noJitter = { jitter: 0 };

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("isRetryableStatus", () => {
  it.each(RETRYABLE_STATUSES)("treats %i as retryable", (status) => {
    expect(isRetryableStatus(status)).toBe(true);
  });

  it.each([200, 201, 204, 400, 401, 403, 404, 409, 422])(
    "treats %i as terminal",
    (status) => {
      expect(isRetryableStatus(status)).toBe(false);
    },
  );

  it("does NOT retry a 500 — the handler ran, so a side effect may have happened", () => {
    // The distinction that makes retrying safe: 503 means "no decision was
    // reached", 500 means "something failed partway through". Retrying the
    // latter can duplicate a write.
    expect(isRetryableStatus(500)).toBe(false);
    expect(isRetryableStatus(503)).toBe(true);
  });
});

describe("computeBackoffDelay", () => {
  it("doubles each attempt", () => {
    const p = { baseDelayMs: 100, maxDelayMs: 10_000, ...noJitter };
    expect(computeBackoffDelay(1, p)).toBe(100);
    expect(computeBackoffDelay(2, p)).toBe(200);
    expect(computeBackoffDelay(3, p)).toBe(400);
    expect(computeBackoffDelay(4, p)).toBe(800);
  });

  it("caps at maxDelayMs", () => {
    const p = { baseDelayMs: 100, maxDelayMs: 250, ...noJitter };
    expect(computeBackoffDelay(3, p)).toBe(250);
    expect(computeBackoffDelay(9, p)).toBe(250);
  });

  it("keeps jittered delays within [exp*(1-jitter), exp] so the cap still holds", () => {
    const p = { baseDelayMs: 1000, maxDelayMs: 1000, jitter: 0.5 };
    // random() === 0 -> no reduction; random() near 1 -> maximum reduction.
    expect(computeBackoffDelay(1, { ...p, random: () => 0 })).toBe(1000);
    expect(computeBackoffDelay(1, { ...p, random: () => 0.999 })).toBeGreaterThanOrEqual(500);
    expect(computeBackoffDelay(1, { ...p, random: () => 0.999 })).toBeLessThanOrEqual(1000);
  });

  it("never returns a negative delay", () => {
    const p = { baseDelayMs: 10, maxDelayMs: 10, jitter: 2, random: () => 0.99 };
    expect(computeBackoffDelay(1, p)).toBeGreaterThanOrEqual(0);
  });
});

describe("fetchWithRetry — opting in", () => {
  it("does not retry unless retryable is true, even on a 503", async () => {
    const request = vi.fn(async () => json({ error: "busy" }, 503));

    const res = await fetchWithRetry(request, { sleep: noSleep });

    expect(request).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(503);
  });

  it("retries a 503 up to maxAttempts once opted in, then returns the last response", async () => {
    const request = vi.fn(async () => json({ error: "busy" }, 503));

    const res = await fetchWithRetry(request, {
      retryable: true,
      maxAttempts: 3,
      sleep: noSleep,
    });

    expect(request).toHaveBeenCalledTimes(3);
    // Exhausted retries look exactly like a call that never retried.
    expect(res.status).toBe(503);
  });

  it("stops as soon as an attempt succeeds", async () => {
    const request = vi
      .fn<(attempt: number) => Promise<Response>>()
      .mockResolvedValueOnce(json({ error: "busy" }, 503))
      .mockResolvedValueOnce(json({ ok: true }, 200));

    const res = await fetchWithRetry(request, { retryable: true, sleep: noSleep });

    expect(request).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("passes the 1-based attempt number to the request", async () => {
    const seen: number[] = [];
    await fetchWithRetry(
      async (attempt) => {
        seen.push(attempt);
        return json({}, 503);
      },
      { retryable: true, maxAttempts: 3, sleep: noSleep },
    );

    expect(seen).toEqual([1, 2, 3]);
  });
});

describe("fetchWithRetry — what must not be retried", () => {
  it.each([200, 400, 401, 403, 404, 409, 422, 500])(
    "returns a %i immediately without retrying",
    async (status) => {
      const request = vi.fn(async () => json({}, status));

      const res = await fetchWithRetry(request, {
        retryable: true,
        maxAttempts: 5,
        sleep: noSleep,
      });

      expect(request).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(status);
    },
  );
});

describe("fetchWithRetry — transport errors", () => {
  it("retries a thrown transport error", async () => {
    const request = vi
      .fn<(attempt: number) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(json({ ok: true }));

    const res = await fetchWithRetry(request, { retryable: true, sleep: noSleep });

    expect(request).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
  });

  it("rethrows the last transport error when every attempt fails", async () => {
    const boom = new TypeError("network down");
    const request = vi.fn(async () => {
      throw boom;
    });

    await expect(
      fetchWithRetry(request, { retryable: true, maxAttempts: 3, sleep: noSleep }),
    ).rejects.toBe(boom);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("does not retry a transport error when the caller did not opt in", async () => {
    const request = vi.fn(async () => {
      throw new TypeError("network down");
    });

    await expect(fetchWithRetry(request, { sleep: noSleep })).rejects.toThrow("network down");
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("fetchWithRetry — backoff and observability", () => {
  it("sleeps with exponential backoff between attempts, and not after the last", async () => {
    const slept: number[] = [];
    const request = vi.fn(async () => json({}, 503));

    await fetchWithRetry(request, {
      retryable: true,
      maxAttempts: 3,
      baseDelayMs: 100,
      ...noJitter,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });

    // 3 attempts -> 2 sleeps. No trailing sleep before giving up.
    expect(slept).toEqual([100, 200]);
  });

  it("reports each retry through onRetry, with the triggering status", async () => {
    const events: RetryEvent[] = [];
    await fetchWithRetry(async () => json({}, 429), {
      retryable: true,
      maxAttempts: 3,
      baseDelayMs: 50,
      ...noJitter,
      sleep: noSleep,
      onRetry: (e) => events.push(e),
    });

    expect(events).toEqual([
      { attempt: 1, maxAttempts: 3, delayMs: 50, status: 429, error: undefined },
      { attempt: 2, maxAttempts: 3, delayMs: 100, status: 429, error: undefined },
    ]);
  });

  it("reports a transport error through onRetry with no status", async () => {
    const events: RetryEvent[] = [];
    const boom = new TypeError("offline");

    await fetchWithRetry(
      vi
        .fn<(attempt: number) => Promise<Response>>()
        .mockRejectedValueOnce(boom)
        .mockResolvedValueOnce(json({})),
      { retryable: true, sleep: noSleep, onRetry: (e) => events.push(e) },
    );

    expect(events).toHaveLength(1);
    expect(events[0].status).toBeUndefined();
    expect(events[0].error).toBe(boom);
  });

  it("rejects a maxAttempts below 1 rather than looping forever", async () => {
    await expect(
      fetchWithRetry(async () => json({}), { retryable: true, maxAttempts: 0 }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});

describe("fetchWithRetry — abort", () => {
  it("does not start a request when the signal is already aborted", async () => {
    const request = vi.fn(async () => json({}));
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchWithRetry(request, { retryable: true, signal: controller.signal, sleep: noSleep }),
    ).rejects.toBeInstanceOf(RequestAbortedError);
    expect(request).not.toHaveBeenCalled();
  });

  it("stops retrying once aborted mid-flight, rather than treating it as transient", async () => {
    const controller = new AbortController();
    const boom = new Error("aborted");
    const request = vi.fn(async () => {
      controller.abort();
      throw boom;
    });

    await expect(
      fetchWithRetry(request, { retryable: true, signal: controller.signal, sleep: noSleep }),
    ).rejects.toBe(boom);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("createRetryingPost", () => {
  it("forwards path and body to the underlying post", async () => {
    const post = vi.fn(async () => json({ ok: true }));
    const send = createRetryingPost(post, { sleep: noSleep });

    await send("/wallet/connect", { keyId: "k1" }, { retryable: true });

    expect(post).toHaveBeenCalledWith("/wallet/connect", { keyId: "k1" });
  });

  it("lets a per-call option override the bound policy", async () => {
    const post = vi.fn(async () => json({}, 503));
    const send = createRetryingPost(post, { maxAttempts: 5, sleep: noSleep });

    await send("/p", {}, { retryable: true, maxAttempts: 2 });

    expect(post).toHaveBeenCalledTimes(2);
  });
});

describe("createRetryingWalletBackend — migrated call sites", () => {
  const CREATED = { sessionId: "sess-1" };

  it("retries /wallet/connect, because a lookup has no side effect to duplicate", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({ contractId: "C1", sessionId: "s1" }));

    const backend = createRetryingWalletBackend("https://api.test", {
      fetchImpl,
      sleep: noSleep,
    });

    await expect(backend.lookupContractId({ keyId: "k", network: "testnet" })).resolves.toEqual({
      contractId: "C1",
      sessionId: "s1",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns undefined for a 404 lookup without retrying it", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({}, 404));

    const backend = createRetryingWalletBackend("https://api.test", { fetchImpl, sleep: noSleep });

    await expect(
      backend.lookupContractId({ keyId: "k", network: "testnet" }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry /wallet/submit — resubmitting a signed tx can pay twice", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ error: "busy" }, 503));

    const backend = createRetryingWalletBackend("https://api.test", { fetchImpl, sleep: noSleep });

    await expect(
      backend.submitTransaction({ signedXdr: "AAAA", network: "testnet" }),
    ).rejects.toBeInstanceOf(WalletApiError);
    // The critical assertion of this whole example.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry /wallet/create — a lost response may mean it already deployed", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ error: "busy" }, 503));

    const backend = createRetryingWalletBackend("https://api.test", { fetchImpl, sleep: noSleep });

    await expect(
      backend.submitWalletCreation({
        keyId: "k",
        contractId: "C",
        network: "testnet",
        signedTx: "tx",
      }),
    ).rejects.toBeInstanceOf(WalletApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("surfaces the gateway's error message and code on a terminal failure", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ error: "bad_request", message: "keyId required" }, 400));

    const backend = createRetryingWalletBackend("https://api.test", { fetchImpl, sleep: noSleep });

    await expect(
      backend.submitTransaction({ signedXdr: "AAAA", network: "testnet" }),
    ).rejects.toMatchObject({ status: 400, message: "keyId required", code: "bad_request" });
  });

  it("falls back to a generic message when the error body is not JSON", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("<html>502</html>", { status: 400 }));

    const backend = createRetryingWalletBackend("https://api.test", { fetchImpl, sleep: noSleep });

    await expect(
      backend.submitTransaction({ signedXdr: "AAAA", network: "testnet" }),
    ).rejects.toMatchObject({ status: 400, message: "Wallet API request failed (400)" });
  });

  it("normalizes a trailing slash on the base URL", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ hash: "h" }));

    const backend = createRetryingWalletBackend("https://api.test///", {
      fetchImpl,
      sleep: noSleep,
    });
    await backend.submitTransaction({ signedXdr: "AAAA", network: "testnet" });

    expect(fetchImpl).toHaveBeenCalledWith("https://api.test/wallet/submit", expect.anything());
  });

  it("still succeeds on a create that works first time", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(CREATED));

    const backend = createRetryingWalletBackend("https://api.test", { fetchImpl, sleep: noSleep });

    await expect(
      backend.submitWalletCreation({
        keyId: "k",
        contractId: "C",
        network: "testnet",
        signedTx: "tx",
      }),
    ).resolves.toEqual(CREATED);
  });
});
