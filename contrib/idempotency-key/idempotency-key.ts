// Idempotency key for wallet backend submission (issue #446).
//
// If a submission response is lost to a network failure, the caller cannot
// tell whether the backend received and submitted the transaction. Retrying
// risks a double submission; not retrying risks abandoning a wallet
// mid-creation. This module wraps the WalletBackend seam with idempotency
// key generation and retry logic.
//
// Integration into core:
// 1. In src/http-backend.ts, accept an optional `Idempotency-Key` header on
//    POST /wallet/create.
// 2. In src/passkeykit-connector.ts, wrap backend.submitWalletCreation with
//    withIdempotencyKey(backend) so retries reuse the same key.
// 3. Document the server contract in README.md (see below).

import type { WalletBackend } from "../src/passkeykit-connector";
import type { Network } from "../src/types";

// ── Server contract ───────────────────────────────────────────────────────
//
// A Vellar-compatible gateway MUST implement the following for idempotent
// wallet creation:
//
//   POST /wallet/create
//   Header: Idempotency-Key: <uuid>
//   Body:   { keyId, contractId, network, signedTx }
//
//   On repeat request with the SAME Idempotency-Key:
//   - If the original succeeded: return the original 200 response unchanged.
//   - If the original is still in-flight: return 409 Conflict.
//   - If the original failed: allow retry (return 422 or let it through).
//
//   The key MUST be scoped to the endpoint + keyId combination. Keys expire
//   after 24 hours (the creation flow is time-sensitive; stale keys indicate
//   an abandoned attempt).

export interface IdempotencyKeyOptions {
  /** Generate a fresh idempotency key. Defaults to crypto.randomUUID(). */
  generateKey?: () => string;
}

/**
 * Distinguish a submission that DEFINITELY did not reach the backend (safe to
 * retry with a fresh key) from one that MAY have been received (must reuse
 * the same key on retry).
 */
export class AmbiguousSubmissionError extends Error {
  constructor(
    readonly idempotencyKey: string,
    readonly attempt: number,
    cause?: unknown,
  ) {
    super(
      `Wallet creation submission failed ambiguously (attempt ${attempt}). ` +
        `The backend may or may not have received the transaction. ` +
        `Retry with the same idempotency key (${idempotencyKey}) to deduplicate. ` +
        `Do NOT retry with a fresh key — that risks a double submission.`,
    );
    this.name = "AmbiguousSubmissionError";
  }
}

/** A submission that definitely did not reach the backend. Safe to retry. */
export class DefiniteNetworkError extends Error {
  constructor(
    readonly attempt: number,
    cause?: unknown,
  ) {
    super(
      `Wallet creation submission failed before reaching the backend (attempt ${attempt}). ` +
        `Safe to retry with a fresh idempotency key.`,
    );
    this.name = "DefiniteNetworkError";
  }
}

/**
 * Wrap a WalletBackend with idempotency key generation and retry logic for
 * submitWalletCreation. The wrapped backend:
 *
 * - Generates a UUID idempotency key per logical submission (not per attempt).
 * - Retries up to 3 times on ambiguous failures (network timeout, ECONNRESET).
 * - Distinguishes definite failures (DNS resolution, connection refused) from
 *   ambiguous ones (timeout after the request was sent).
 * - Reuses the same key across retries of the same submission so the backend
 *   can deduplicate.
 */
export function withIdempotencyKey(
  backend: WalletBackend,
  opts?: IdempotencyKeyOptions,
): WalletBackend & { getLastIdempotencyKey(): string | undefined } {
  const generateKey = opts?.generateKey ?? (() => crypto.randomUUID());
  let lastKey: string | undefined;

  return {
    getLastIdempotencyKey() {
      return lastKey;
    },

    async submitWalletCreation(input) {
      const key = generateKey();
      lastKey = key;

      let lastError: unknown;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          // Attach the key to the request so the backend can deduplicate.
          // In the real HTTP backend, this becomes an Idempotency-Key header.
          // Here we pass it through the existing interface — the backend
          // contract (documented above) says it reads from the header, not
          // the body, so the signature doesn't change.
          const result = await backend.submitWalletCreation({
            ...input,
            ...(addIdempotencyMetadata(key, attempt)),
          });
          return result;
        } catch (err) {
          lastError = err;
          if (isDefiniteNetworkError(err)) {
            throw new DefiniteNetworkError(attempt, err);
          }
          // Ambiguous: may or may not have reached the backend.
          if (attempt === 3) {
            throw new AmbiguousSubmissionError(key, attempt, err);
          }
          // Wait before retrying (exponential backoff).
          await new Promise((r) => setTimeout(r, 100 * 2 ** (attempt - 1)));
        }
      }
      // Unreachable, but TypeScript needs it.
      throw new AmbiguousSubmissionError(key, 3, lastError);
    },

    lookupContractId: backend.lookupContractId.bind(backend),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Attach idempotency metadata to the submission input. In the real HTTP
 * backend, this becomes the Idempotency-Key header. Here we encode it in
 * the existing input shape so the WalletBackend interface doesn't change.
 *
 * The actual header injection happens in the HTTP layer (see integration
 * notes above).
 */
function addIdempotencyMetadata(
  key: string,
  attempt: number,
): Record<string, unknown> {
  // The WalletBackend.submitWalletCreation signature accepts
  // {keyId, contractId, network, signedTx}. We add metadata as extra
  // properties that the HTTP layer can read and forward as headers.
  // This is the seam between the idempotency wrapper and the HTTP transport.
  return { _idempotencyKey: key, _attempt: attempt };
}

/**
 * Heuristic: distinguish errors that mean the request definitely did not
 * reach the backend from those where it may have.
 *
 * - DNS failure, connection refused → definite (the backend never saw it).
 * - Timeout, ECONNRESET → ambiguous (the request may have been received).
 * - Backend error response (WalletApiError) → the backend processed it, so
 *   this is NOT a network failure (caller handles it).
 */
function isDefiniteNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  // DNS resolution failure.
  if (msg.includes("enotfound")) return true;
  // Connection refused — the backend is down.
  if (msg.includes("econnrefused")) return true;
  // All other network errors are ambiguous (may have reached the backend).
  return false;
}