/**
 * `src/http-backend.ts`'s three call sites, migrated onto the shared wrapper.
 *
 * This is the "migrate existing call sites" half of issue #301, shown as a
 * working reference rather than a patch, so the retry semantics can be
 * reviewed and tested before `src/http-backend.ts` itself changes.
 *
 * The structure deliberately mirrors the real `createHttpWalletBackend`:
 * same interface, same error type, same `post()` helper, same base-URL
 * normalization. The only difference is that each call site now declares
 * whether it may be retried, and the retry itself lives in one place
 * (`createRetryingPost`) instead of being open-coded three times.
 *
 * The per-endpoint decisions, which are the substance of the change:
 *
 *   | Endpoint          | Retryable | Why                                     |
 *   | ----------------- | --------- | --------------------------------------- |
 *   | `/wallet/connect` | yes       | A pure lookup. No side effect, so a     |
 *   |                   |           | replay costs at most a wasted request.  |
 *   | `/wallet/create`  | no        | Deploys a wallet. A lost response may   |
 *   |                   |           | mean it already deployed.               |
 *   | `/wallet/submit`  | no        | Submits a SIGNED transaction. Retrying  |
 *   |                   |           | can double-submit and pay twice.        |
 *
 * The two writes are left non-retryable on purpose. They could be made safe
 * with an idempotency key echoed by the gateway (see the README), but that is
 * a protocol change, and silently retrying them without one is the bug this
 * wrapper exists to prevent.
 */

import {
  createRetryingPost,
  type RetryPolicy,
  type RetryRequestOptions,
} from "./http-retry";

/** Mirrors `WalletApiError` from `src/http-backend.ts`. */
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
    payload?.message ?? payload?.error ?? `Wallet API request failed (${res.status})`,
    res.status,
    payload?.error,
  );
}

/** Mirrors `HttpWalletBackend` from `src/http-backend.ts`. */
export interface HttpWalletBackend {
  submitWalletCreation(input: {
    keyId: string;
    contractId: string;
    network: string;
    signedTx: unknown;
  }): Promise<{ sessionId: string }>;
  lookupContractId(input: {
    keyId: string;
    network: string;
  }): Promise<{ contractId: string; sessionId: string } | undefined>;
  submitTransaction(input: {
    signedXdr: string;
    network: string;
  }): Promise<{ hash: string }>;
}

export interface RetryingBackendOptions extends RetryPolicy {
  /** Optional fetch (defaults to the global fetch). */
  fetchImpl?: typeof fetch;
  /**
   * Serializer for the signed transaction. The real backend uses
   * `defaultSignedToXdr` from `src/passkeykit-connector`; kept injectable here
   * so this example stays self-contained.
   */
  signedToXdr?: (signed: unknown) => unknown;
}

/**
 * The same backend `createHttpWalletBackend` returns, with retries centralized.
 *
 * `retryPolicy` tunes backoff for the whole backend; per-endpoint retryability
 * is fixed by the safety analysis above and is not configurable, because
 * "retry my signed submission" is never a safe thing to opt into.
 */
export function createRetryingWalletBackend(
  apiUrl: string,
  options: RetryingBackendOptions = {},
): HttpWalletBackend {
  const base = apiUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const signedToXdr = options.signedToXdr ?? ((signed: unknown) => signed);

  // The one private helper the real file already has.
  const post = (path: string, body: unknown): Promise<Response> =>
    fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  // The single choke point. Every call site below goes through this.
  const send = createRetryingPost(post, {
    maxAttempts: options.maxAttempts,
    baseDelayMs: options.baseDelayMs,
    maxDelayMs: options.maxDelayMs,
    jitter: options.jitter,
    sleep: options.sleep,
    random: options.random,
    onRetry: options.onRetry,
  });

  // Reads are safe to replay; writes are not. Named so each call site reads as
  // a deliberate decision rather than a magic boolean.
  const READ: RetryRequestOptions = { retryable: true };
  const WRITE: RetryRequestOptions = { retryable: false };

  return {
    async submitWalletCreation({ keyId, contractId, network, signedTx }) {
      // NOT retried: a lost response may mean the wallet already deployed.
      const res = await send(
        "/wallet/create",
        { keyId, contractId, network, signedTx: signedToXdr(signedTx) },
        WRITE,
      );
      if (!res.ok) throw await toApiError(res);
      return (await res.json()) as { sessionId: string };
    },

    async lookupContractId({ keyId, network }) {
      // Retried: a pure lookup, no side effect to duplicate.
      const res = await send("/wallet/connect", { keyId, network }, READ);
      if (res.status === 404) return undefined;
      if (!res.ok) throw await toApiError(res);
      return (await res.json()) as { contractId: string; sessionId: string };
    },

    async submitTransaction({ signedXdr, network }) {
      // NOT retried: resubmitting a signed transaction can pay twice.
      const res = await send("/wallet/submit", { signedXdr, network }, WRITE);
      if (!res.ok) throw await toApiError(res);
      return (await res.json()) as { hash: string };
    },
  };
}
