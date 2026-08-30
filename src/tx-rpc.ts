import { rpc, StrKey, Transaction } from "@stellar/stellar-sdk";
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

/** Thrown when an RPC submission is rejected by the client-side rate limiter. */
export class RateLimitError extends Error {
  constructor(message = "RPC submission rate limit exceeded") {
    super(message);
    this.name = "RateLimitError";
  }
}

export interface RpcRateLimitOptions {
  /** Maximum tokens the bucket can hold. */
  bucketSize: number;
  /** Tokens added per second. */
  refillRate: number;
}

export interface RpcTxSubmitterOptions {
  rpcUrl: string;
  /** When set, submission calls are guarded by a per-client token bucket. */
  rateLimit?: RpcRateLimitOptions;
  /** Injected RPC server (for tests). Defaults to a new rpc.Server(rpcUrl). */
  server?: Pick<rpc.Server, "sendTransaction">;
}

export interface RpcTxSubmitter {
  submitTransaction(signedXdr: string): Promise<{ hash: string }>;
}

/** Token bucket keyed to one RPC client instance — not shared across submitters. */
export class TokenBucket {
  #tokens: number;
  #lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.#tokens = capacity;
    this.#lastRefill = now();
  }

  /** Returns true and consumes one token when allowed; false when over limit. */
  tryConsume(): boolean {
    this.#refill();
    if (this.#tokens >= 1) {
      this.#tokens -= 1;
      return true;
    }
    return false;
  }

  #refill(): void {
    const t = this.now();
    const elapsed = t - this.#lastRefill;
    this.#tokens = Math.min(this.capacity, this.#tokens + elapsed * this.refillPerMs);
    this.#lastRefill = t;
  }
}

export function createRpcTxSubmitter(options: RpcTxSubmitterOptions): RpcTxSubmitter {
  const server = options.server ?? new rpc.Server(options.rpcUrl);
  const limiter =
    options.rateLimit &&
    new TokenBucket(
      options.rateLimit.bucketSize,
      options.rateLimit.refillRate / 1000,
    );

  return {
    async submitTransaction(signedXdr) {
      if (limiter && !limiter.tryConsume()) {
        throw new RateLimitError();
      }
      const tx = Transaction.fromXDR(signedXdr, "base64");
      const res = await server.sendTransaction(tx);
      if (res.status === "ERROR") {
        throw new Error(
          res.errorResult?.toXDR("base64") ?? "sendTransaction failed",
        );
      }
      if (!res.hash) {
        throw new Error("sendTransaction returned no hash");
      }
      return { hash: res.hash };
    },
  };
}
