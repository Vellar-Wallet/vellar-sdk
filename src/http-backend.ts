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

export class WalletApiAbortError extends Error {
  constructor() {
    super("Wallet API request was aborted");
    this.name = "WalletApiAbortError";
  }
}

export interface HttpWalletBackendOptions {
  /** Per-attempt request timeout. Defaults to 30 seconds. */
  timeoutMs?: number;
  /** Retries for idempotent reads only. Defaults to 2. */
  maxRetries?: number;
  /** Initial retry backoff. Defaults to 200ms and doubles per attempt. */
  retryDelayMs?: number;
  /** Optional signal applied to every request made by this backend. */
  signal?: AbortSignal;
  /** Fetch implementation, useful for tests and custom runtimes. */
  fetchImpl?: typeof fetch;
}

export interface WalletActivityToken {
  contractId: string;
  symbol?: string;
  decimals?: number;
}

export interface WalletActivityItem {
  id: string;
  type: string;
  counterparty?: string;
  amount?: string;
  token?: WalletActivityToken;
  transactionHash: string;
  timestamp: string;
}

export interface WalletActivityPage {
  items: WalletActivityItem[];
  hasMore: boolean;
  nextCursor?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.length > 0);
}

function mapActivityItem(value: unknown, index: number): WalletActivityItem | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const data = asRecord(record.data) ?? {};
  const type = stringField(
    record.type,
    record.kind,
    record.eventType,
    data.type,
    data.kind,
    data.action,
  ) ?? "transaction";
  const timestamp = stringField(record.timestamp, record.at, record.createdAt);
  if (!timestamp) return undefined;
  const counterparty = stringField(
    record.counterparty,
    record.to,
    record.recipient,
    data.counterparty,
    data.to,
    data.recipient,
  );
  const rawAmount = record.amount ?? data.amount;

  const rawToken = record.token ?? data.token;
  let token: WalletActivityToken | undefined;
  if (typeof rawToken === "string") {
    token = { contractId: rawToken };
  } else {
    const tokenRecord = asRecord(rawToken);
    const contractId = stringField(tokenRecord?.contractId, tokenRecord?.id);
    if (contractId) {
      token = {
        contractId,
        ...(typeof tokenRecord?.symbol === "string" && { symbol: tokenRecord.symbol }),
        ...(typeof tokenRecord?.decimals === "number" && { decimals: tokenRecord.decimals }),
      };
    }
  }

  const transactionHash = stringField(
    record.transactionHash,
    record.txHash,
    record.hash,
    data.transactionHash,
    data.txHash,
  );
  if (!transactionHash) return undefined;
  return {
    id: stringField(record.id) ?? `${type}:${timestamp}:${index}`,
    type,
    ...(counterparty && { counterparty }),
    ...((typeof rawAmount === "string" || typeof rawAmount === "number") && {
      amount: String(rawAmount),
    }),
    ...(token && { token }),
    transactionHash,
    timestamp,
  };
}

const RETRYABLE_STATUSES = new Set([408, 429, 502, 503, 504]);

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new WalletApiAbortError());
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new WalletApiAbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
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
    sessionId: string;
    network: Network;
    limit?: number;
    cursor?: string;
    signal?: AbortSignal;
  }): Promise<WalletActivityPage>;
}

/**
 * Create an HTTP backend pointed at your gateway's base URL (e.g.
 * "https://api.myapp.com"). Suitable to pass directly as
 * `createVellarWallet({ backend })`.
 *
 * @param apiUrl   Base URL of your Vellar-compatible gateway.
 * @param fetchOrOptions Optional fetch implementation (legacy form) or backend options.
 * @param additionalOptions Options when using the legacy fetch implementation argument.
 */
export function createHttpWalletBackend(
  apiUrl: string,
  fetchOrOptions: typeof fetch | HttpWalletBackendOptions = {},
  additionalOptions?: HttpWalletBackendOptions,
): HttpWalletBackend {
  const base = apiUrl.replace(/\/+$/, "");
  const options = additionalOptions ?? (typeof fetchOrOptions === "function" ? {} : fetchOrOptions);
  const fetchImpl =
    typeof fetchOrOptions === "function"
      ? fetchOrOptions
      : options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxRetries = options.maxRetries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 200;

  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError("timeoutMs must be a positive integer");
  }
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new RangeError("maxRetries must be a non-negative integer");
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
    throw new RangeError("retryDelayMs must be a non-negative number");
  }

  const request = async (
    method: "GET" | "POST",
    path: string,
    body: unknown,
    requestOptions: {
      signal?: AbortSignal;
      retryable?: boolean;
      headers?: Record<string, string>;
    } = {},
  ): Promise<Response> => {
    const signal = requestOptions.signal ?? options.signal;
    const retryable = requestOptions.retryable === true;
    const attempts = retryable ? maxRetries + 1 : 1;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (signal?.aborted) throw new WalletApiAbortError();

      const controller = new AbortController();
      let timedOut = false;
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      let response: Response | undefined;
      let failure: unknown;
      try {
        response = await fetchImpl(`${base}${path}`, {
          method,
          ...((method === "POST" || requestOptions.headers) && {
            headers: {
              ...(method === "POST" && { "content-type": "application/json" }),
              ...requestOptions.headers,
            },
          }),
          ...(method === "POST" && {
            body: JSON.stringify(body),
          }),
          signal: controller.signal,
        });
      } catch (error) {
        failure = timedOut
          ? new WalletApiTimeoutError(timeoutMs)
          : signal?.aborted
            ? new WalletApiAbortError()
            : error;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }

      if (signal?.aborted) throw new WalletApiAbortError();
      const shouldRetry =
        retryable &&
        attempt + 1 < attempts &&
        (failure !== undefined || (response !== undefined && RETRYABLE_STATUSES.has(response.status)));

      if (!shouldRetry) {
        if (failure !== undefined) throw failure;
        return response as Response;
      }

      await abortableDelay(retryDelayMs * 2 ** attempt, signal);
    }

    throw new Error("Unreachable HTTP retry state");
  };

  const post = (path: string, body: unknown, signal?: AbortSignal): Promise<Response> =>
    request("POST", path, body, { signal });

  return {
    async submitWalletCreation({ keyId, contractId, network, signedTx, signal }) {
      const res = await post("/wallet/create", {
        keyId,
        contractId,
        network,
        signedTx: defaultSignedToXdr(signedTx),
      }, signal);
      if (!res.ok) throw await toApiError(res);
      return (await res.json()) as { sessionId: string };
    },

    async lookupContractId({ keyId, network, signal }) {
      const res = await post("/wallet/connect", { keyId, network }, signal);
      if (res.status === 404) return undefined;
      if (!res.ok) throw await toApiError(res);
      return (await res.json()) as { contractId: string; sessionId: string };
    },

    async submitTransaction({ signedXdr, network, signal }) {
      const res = await post("/wallet/submit", { signedXdr, network }, signal);
      if (!res.ok) throw await toApiError(res);
      return (await res.json()) as { hash: string };
    },

    async listActivity({ accountId, sessionId, network, limit = 20, cursor, signal }) {
      const query = new URLSearchParams({ contractId: accountId, network, limit: String(limit) });
      if (cursor) query.set("after", cursor);
      const res = await request("GET", `/wallet/transactions?${query}`, undefined, {
        signal,
        retryable: true,
        headers: { authorization: `Bearer ${sessionId}` },
      });
      if (!res.ok) throw await toApiError(res);

      const payload = asRecord(await res.json());
      const records = Array.isArray(payload?.transactions) ? payload.transactions : [];
      const items = records
        .map((record, index) => mapActivityItem(record, index))
        .filter((item): item is WalletActivityItem => item !== undefined);
      const nextCursor = stringField(payload?.nextCursor);
      return {
        items,
        hasMore: payload?.hasMore === true,
        ...(nextCursor && { nextCursor }),
      };
    },
  };
}
