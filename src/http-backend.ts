import type { Network } from "./types";
import { defaultSignedToXdr } from "./passkeykit-connector";

// HTTP implementation of the backend the SDK needs — talks to a Vellar-
// compatible gateway (POST /wallet/create, /wallet/connect, /wallet/submit).
// Consumers run their own backend (which holds the relayer/sponsor secrets);
// this is the client that speaks to it, so nobody has to hand-write the fetch
// wrapper. Pass the result straight to `createVellarWallet({ backend })`.

export class WalletApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "WalletApiError";
    this.status = status;
    this.code = code;
  }
}

export class WalletApiTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Wallet API request timed out after ${timeoutMs}ms`);
    this.name = "WalletApiTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export interface HttpWalletBackendOptions {
  /** Optional fetch implementation; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in milliseconds. Defaults to 10 seconds. */
  timeoutMs?: number;
  /** Retries after the initial attempt for safe reads. Defaults to 2. */
  maxRetries?: number;
  /** Initial retry delay in milliseconds. Defaults to 200. */
  retryBaseDelayMs?: number;
  /** Maximum retry delay in milliseconds. Defaults to 2000. */
  retryMaxDelayMs?: number;
}

interface RequestOptions {
  signal?: AbortSignal;
  retryable?: boolean;
}

async function toApiError(res: Response): Promise<WalletApiError> {
  let payload: { error?: string; message?: string } | undefined;
  try {
    payload = (await res.json()) as { error?: string; message?: string };
  } catch {
    // Non-JSON error body — fall through to the generic message.
  }
  return new WalletApiError(
    payload?.message ??
      payload?.error ??
      `Wallet API request failed (${res.status})`,
    res.status,
    payload?.error,
  );
}

export interface HttpWalletBackend {
  submitWalletCreation(input: {
    keyId: string;
    contractId: string;
    network: Network;
    signedTx: unknown;
    signal?: AbortSignal;
  }): Promise<{ sessionId: string }>;
  lookupContractId(input: {
    keyId: string;
    network: Network;
    signal?: AbortSignal;
  }): Promise<{ contractId: string; sessionId: string } | undefined>;
  submitTransaction(input: {
    signedXdr: string;
    network: Network;
    signal?: AbortSignal;
  }): Promise<{ hash: string }>;
  listActivity(input: {
    accountId: string;
    network: Network;
    bearerSessionId: string;
    limit?: number;
    after?: string;
    signal?: AbortSignal;
  }): Promise<WalletActivityPage>;
}

export interface WalletActivityToken {
  symbol?: string;
  contractId?: string;
  decimals?: number;
}

export interface WalletActivityEntry {
  type: string;
  counterparty?: string;
  /** Exact decimal or base-unit representation supplied by the gateway. */
  amount?: string;
  token?: WalletActivityToken;
  txHash: string;
  timestamp: string;
}

export interface WalletActivityPage {
  entries: WalletActivityEntry[];
  hasMore: boolean;
  nextCursor?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapActivityEntry(value: unknown): WalletActivityEntry {
  if (!isRecord(value)) throw new Error("Wallet API returned an invalid activity entry");
  const txHash = value.txHash;
  const timestamp = value.at ?? value.timestamp;
  if (typeof txHash !== "string" || typeof timestamp !== "string") {
    throw new Error("Wallet API activity entries require txHash and timestamp");
  }

  const result: WalletActivityEntry = {
    type: typeof value.type === "string" ? value.type : "tx.submitted",
    txHash,
    timestamp,
  };
  if (typeof value.counterparty === "string") result.counterparty = value.counterparty;
  if (typeof value.amount === "string") result.amount = value.amount;

  const token = value.token ?? value.asset;
  if (typeof token === "string") {
    result.token = { symbol: token };
  } else if (isRecord(token)) {
    const mapped: WalletActivityToken = {};
    if (typeof token.symbol === "string") mapped.symbol = token.symbol;
    if (typeof token.contractId === "string") mapped.contractId = token.contractId;
    if (typeof token.decimals === "number" && Number.isInteger(token.decimals) && token.decimals >= 0) {
      mapped.decimals = token.decimals;
    }
    if (Object.keys(mapped).length > 0) result.token = mapped;
  }
  return result;
}

const RETRYABLE_STATUSES = new Set([408, 429, 502, 503, 504]);

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

async function waitBeforeRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortReason(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortReason(signal as AbortSignal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

/**
 * Create an HTTP backend pointed at your gateway's base URL (e.g.
 * "https://api.myapp.com"). Suitable to pass directly as
 * `createVellarWallet({ backend })`.
 *
 * @param apiUrl   Base URL of your Vellar-compatible gateway.
 * @param fetchImpl Optional fetch (defaults to the global fetch).
 */
export function createHttpWalletBackend(
  apiUrl: string,
  fetchImplOrOptions: typeof fetch | HttpWalletBackendOptions = globalThis.fetch.bind(globalThis),
  legacyOptions: Omit<HttpWalletBackendOptions, "fetchImpl"> = {},
): HttpWalletBackend {
  const base = apiUrl.replace(/\/+$/, "");
  const options: HttpWalletBackendOptions =
    typeof fetchImplOrOptions === "function"
      ? { ...legacyOptions, fetchImpl: fetchImplOrOptions }
      : fetchImplOrOptions;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxRetries = options.maxRetries ?? 2;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 200;
  const retryMaxDelayMs = options.retryMaxDelayMs ?? 2_000;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`timeoutMs must be a positive number, got ${timeoutMs}`);
  }
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new RangeError(`maxRetries must be a non-negative integer, got ${maxRetries}`);
  }
  if (!Number.isFinite(retryBaseDelayMs) || retryBaseDelayMs < 0) {
    throw new RangeError(`retryBaseDelayMs must be a non-negative number, got ${retryBaseDelayMs}`);
  }
  if (!Number.isFinite(retryMaxDelayMs) || retryMaxDelayMs < 0) {
    throw new RangeError(`retryMaxDelayMs must be a non-negative number, got ${retryMaxDelayMs}`);
  }

  async function withTimeout<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) throw abortReason(signal);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new WalletApiTimeoutError(timeoutMs));
        controller.abort();
      }, timeoutMs);
    });
    const abortPromise = signal
      ? new Promise<never>((_resolve, reject) => {
          onAbort = () => {
            reject(abortReason(signal));
            controller.abort(signal.reason);
          };
          signal.addEventListener("abort", onAbort, { once: true });
          if (signal.aborted) onAbort();
        })
      : undefined;

    try {
      return await Promise.race([
          operation(controller.signal),
        timeoutPromise,
        ...(abortPromise ? [abortPromise] : []),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    }
  }

  async function send<T>(
    url: string,
    init: RequestInit,
    requestOptions: RequestOptions,
    readResponse: (response: Response) => Promise<T>,
  ): Promise<T> {
    const attempts = requestOptions.retryable ? maxRetries + 1 : 1;
    return withTimeout(async (signal) => {
      for (let attempt = 0; ; attempt++) {
        let response: Response;
        try {
          response = await fetchImpl(url, { ...init, signal });
        } catch (error) {
          if (signal.aborted || !requestOptions.retryable || attempt + 1 >= attempts) throw error;
          const delayMs = Math.min(retryBaseDelayMs * 2 ** attempt, retryMaxDelayMs);
          await waitBeforeRetry(delayMs, signal);
          continue;
        }

        if (requestOptions.retryable && RETRYABLE_STATUSES.has(response.status) && attempt + 1 < attempts) {
          const delayMs = Math.min(retryBaseDelayMs * 2 ** attempt, retryMaxDelayMs);
          await waitBeforeRetry(delayMs, signal);
          continue;
        }
        return readResponse(response);
      }
    }, requestOptions.signal);
  }

  const post = <T>(
    path: string,
    body: unknown,
    requestOptions: RequestOptions,
    readResponse: (response: Response) => Promise<T>,
  ) =>
    send<T>(
      `${base}${path}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      requestOptions,
      readResponse,
    );

  return {
    submitWalletCreation({ keyId, contractId, network, signedTx, signal }) {
      return post(
        "/wallet/create",
        { keyId, contractId, network, signedTx: defaultSignedToXdr(signedTx) },
        { signal },
        async (res) => {
          if (!res.ok) throw await toApiError(res);
          return (await res.json()) as { sessionId: string };
        },
      );
    },

    lookupContractId({ keyId, network, signal }) {
      return post(
        "/wallet/connect",
        { keyId, network },
        { signal, retryable: true },
        async (res) => {
          if (res.status === 404) return undefined;
          if (!res.ok) throw await toApiError(res);
          return (await res.json()) as { contractId: string; sessionId: string };
        },
      );
    },

    submitTransaction({ signedXdr, network, signal }) {
      return post(
        "/wallet/submit",
        { signedXdr, network },
        { signal },
        async (res) => {
          if (!res.ok) throw await toApiError(res);
          return (await res.json()) as { hash: string };
        },
      );
    },

    listActivity({ accountId, network, bearerSessionId, limit = 20, after, signal }) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new RangeError(`limit must be an integer between 1 and 100, got ${limit}`);
      }
      if (!bearerSessionId) throw new TypeError("bearerSessionId is required to read wallet activity");

      const query = new URLSearchParams({ contractId: accountId, network, limit: String(limit) });
      if (after) query.set("after", after);
      return send(
        `${base}/wallet/transactions?${query.toString()}`,
        { method: "GET", headers: { authorization: `Bearer ${bearerSessionId}` } },
        { signal, retryable: true },
        async (res) => {
          if (!res.ok) throw await toApiError(res);
          const payload: unknown = await res.json();
          if (!isRecord(payload) || !Array.isArray(payload.transactions)) {
            throw new Error("Wallet API returned an invalid activity page");
          }
          return {
            entries: payload.transactions.map(mapActivityEntry),
            hasMore: payload.hasMore === true,
            nextCursor: typeof payload.nextCursor === "string" ? payload.nextCursor : undefined,
          };
        },
      );
    },
  };
}
