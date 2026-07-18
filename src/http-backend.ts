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
  }): Promise<{ sessionId: string }>;
  lookupContractId(input: {
    keyId: string;
    network: Network;
  }): Promise<{ contractId: string; sessionId: string } | undefined>;
  submitTransaction(input: {
    signedXdr: string;
    network: Network;
  }): Promise<{ hash: string }>;
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
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): HttpWalletBackend {
  const base = apiUrl.replace(/\/+$/, "");

  const post = (path: string, body: unknown): Promise<Response> =>
    fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  return {
    async submitWalletCreation({ keyId, contractId, network, signedTx }) {
      const res = await post("/wallet/create", {
        keyId,
        contractId,
        network,
        signedTx: defaultSignedToXdr(signedTx),
      });
      if (!res.ok) throw await toApiError(res);
      return (await res.json()) as { sessionId: string };
    },

    async lookupContractId({ keyId, network }) {
      const res = await post("/wallet/connect", { keyId, network });
      if (res.status === 404) return undefined;
      if (!res.ok) throw await toApiError(res);
      return (await res.json()) as { contractId: string; sessionId: string };
    },

    async submitTransaction({ signedXdr, network }) {
      const res = await post("/wallet/submit", { signedXdr, network });
      if (!res.ok) throw await toApiError(res);
      return (await res.json()) as { hash: string };
    },
  };
}
