import { rpc, StrKey } from "@stellar/stellar-sdk";
import type { TxStatus, TxStatusReader } from "./tx-status";

// RPC-backed pieces of the payment flow (subpath export — see rpc.ts).

/** Accepts classic (G...) and contract (C...) addresses. */
export function isValidStellarAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address) || StrKey.isValidContract(address);
}

/** Configuration for a single RPC endpoint. */
export interface RpcEndpoint {
  /** The URL of the Soroban RPC endpoint. */
  url: string;
  /** Timeout in milliseconds for this endpoint (default: 10_000). */
  timeoutMs?: number;
}

/** Configuration options for the RPC tx status reader. */
export interface RpcTxStatusReaderOptions {
  /**
   * Primary RPC endpoint URL (for backward compatibility).
   * If `endpoints` is provided, this is ignored.
   */
  rpcUrl?: string;
  /**
   * Prioritized list of RPC endpoints to try.
   * The first endpoint is the primary; subsequent endpoints are fallbacks.
   * If a request to an endpoint times out or fails, the next endpoint is tried.
   */
  endpoints?: RpcEndpoint[];
  /**
   * Default timeout in milliseconds for endpoints that don't specify their own.
   * Default: 10_000 ms.
   */
  defaultTimeoutMs?: number;
}

/**
 * Determines whether an error should trigger a fallback to the next endpoint.
 * Network errors, timeouts, and 5xx errors are considered retryable.
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Timeouts
    if (message.includes("timeout") || message.includes("aborted")) return true;
    // Network errors
    if (
      message.includes("econnrefused") ||
      message.includes("econnreset") ||
      message.includes("enotfound") ||
      message.includes("network") ||
      message.includes("fetch") ||
      message.includes("socket hang up")
    ) {
      return true;
    }
    // HTTP 5xx errors
    if (message.includes("500") || message.includes("502") || message.includes("503") || message.includes("504")) {
      return true;
    }
  }
  return false;
}

/**
 * Normalizes the old single-URL config and the new multi-endpoint config
 * into a flat list of RpcEndpoint.
 */
function resolveEndpoints(options: RpcTxStatusReaderOptions): RpcEndpoint[] {
  if (options.endpoints && options.endpoints.length > 0) {
    return options.endpoints;
  }
  if (options.rpcUrl) {
    return [{ url: options.rpcUrl }];
  }
  throw new Error("Either 'rpcUrl' or 'endpoints' must be provided");
}

/**
 * Creates a TxStatusReader that routes requests through a prioritized list
 * of RPC endpoints with automatic fallback on timeout or error.
 *
 * @example
 * ```ts
 * // Single endpoint (backward compatible)
 * const reader = createRpcTxStatusReader({ rpcUrl: "https://rpc.example.com" });
 *
 * // Multiple endpoints with fallback
 * const reader = createRpcTxStatusReader({
 *   endpoints: [
 *     { url: "https://primary-rpc.example.com", timeoutMs: 5_000 },
 *     { url: "https://backup-rpc.example.com", timeoutMs: 10_000 },
 *     { url: "https://emergency-rpc.example.com" },
 *   ],
 *   defaultTimeoutMs: 10_000,
 * });
 * ```
 */
export function createRpcTxStatusReader(options: RpcTxStatusReaderOptions): TxStatusReader {
  const endpoints = resolveEndpoints(options);
  const defaultTimeout = options.defaultTimeoutMs ?? 10_000;

  // Pre-create servers for each endpoint for reuse
  const servers = endpoints.map((ep) => new rpc.Server(ep.url));

  return {
    async getStatus(hash): Promise<TxStatus> {
      let lastError: unknown;

      for (let i = 0; i < servers.length; i++) {
        const server = servers[i]!;
        const timeoutMs = endpoints[i]!.timeoutMs ?? defaultTimeout;

        try {
          const res = await withTimeout(server.getTransaction(hash), timeoutMs);
          switch (res.status) {
            case rpc.Api.GetTransactionStatus.SUCCESS:
              return "success";
            case rpc.Api.GetTransactionStatus.FAILED:
              return "failed";
            default:
              // NOT_FOUND: not yet included in a ledger.
              return "pending";
          }
        } catch (error) {
          lastError = error;
          // Only fall back if the error is retryable and there are more endpoints
          if (isRetryableError(error) && i < servers.length - 1) {
            continue;
          }
          // Non-retryable error or last endpoint — rethrow
          throw error;
        }
      }

      // Should not reach here, but just in case
      throw lastError;
    },
  };
}

/**
 * Wraps a promise with a timeout. Rejects with a timeout error if the
 * promise does not resolve within the specified time.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
