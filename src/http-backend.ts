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
    correlationId?: string;
  }): Promise<{ sessionId: string }>;
  lookupContractId(input: {
    keyId: string;
    network: Network;
    correlationId?: string;
  }): Promise<{ contractId: string; sessionId: string } | undefined>;
  submitTransaction(input: {
    signedXdr: string;
    network: Network;
    correlationId?: string;
  }): Promise<{ hash: string }>;
}

export interface HttpWalletBackendOptions {
  /** Optional fallback/default correlation ID (or generator) attached to requests when not given per-call. */
  correlationId?: string | (() => string | undefined);
}

/**
 * Create an HTTP backend pointed at your gateway's base URL (e.g.
 * "https://api.myapp.com"). Suitable to pass directly as
 * `createVellarWallet({ backend })`.
 *
 * @param apiUrl   Base URL of your Vellar-compatible gateway.
 * @param fetchImpl Optional fetch (defaults to the global fetch).
 * @param options  Optional configuration (e.g. default correlation ID).
 */
export function createHttpWalletBackend(
  apiUrl: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  options: HttpWalletBackendOptions = {},
): HttpWalletBackend {
  const base = apiUrl.replace(/\/+$/, "");

  function resolveCorrelationId(explicit?: string): string | undefined {
    if (explicit !== undefined) return explicit;
    if (typeof options.correlationId === "function") {
      return options.correlationId();
    }
    return options.correlationId;
  }

  const post = (path: string, body: unknown, correlationId?: string): Promise<Response> => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const cid = resolveCorrelationId(correlationId);
    if (cid) {
      headers["x-correlation-id"] = cid;
    }
    return fetchImpl(`${base}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  };

  return {
    async submitWalletCreation({ keyId, contractId, network, signedTx, correlationId }) {
      const res = await post(
        "/wallet/create",
        {
          keyId,
          contractId,
          network,
          signedTx: defaultSignedToXdr(signedTx),
        },
        correlationId,
      );
      if (!res.ok) throw await toApiError(res);
      return (await res.json()) as { sessionId: string };
    },

    async lookupContractId({ keyId, network, correlationId }) {
      const res = await post("/wallet/connect", { keyId, network }, correlationId);
      if (res.status === 404) return undefined;
      if (!res.ok) throw await toApiError(res);
      return (await res.json()) as { contractId: string; sessionId: string };
    },

    async submitTransaction({ signedXdr, network, correlationId }) {
      const res = await post("/wallet/submit", { signedXdr, network }, correlationId);
      if (!res.ok) throw await toApiError(res);
      return (await res.json()) as { hash: string };
    },
  };
}
