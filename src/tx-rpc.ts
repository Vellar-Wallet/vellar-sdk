import { rpc, StrKey, Transaction } from "@stellar/stellar-sdk";
import type { TxStatus, TxStatusReader } from "./tx-status";
import { retryWithBackoff, type RetryOptions } from "./rpc-retry";

// RPC-backed pieces of the payment flow (subpath export — see rpc.ts).

/** Accepts classic (G...) and contract (C...) addresses. */
export function isValidStellarAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address) || StrKey.isValidContract(address);
}

export function createRpcTxStatusReader(options: { rpcUrl: string }): TxStatusReader {
  const server = new rpc.Server(options.rpcUrl);
  return {
    async getStatus(hash): Promise<TxStatus> {
      const res = await server.getTransaction(hash);
      switch (res.status) {
        case rpc.Api.GetTransactionStatus.SUCCESS:
          return "success";
        case rpc.Api.GetTransactionStatus.FAILED:
          return "failed";
        default:
          // NOT_FOUND: not yet included in a ledger.
          return "pending";
      }
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
  /**
   * Retry `sendTransaction` with exponential backoff on failure, via the
   * shared ./rpc-retry utility (#297) — a dropped connection or a transient
   * RPC-node error shouldn't fail the whole submission. Omit for no retry
   * (the pre-#297 behaviour: one attempt, fail immediately). `isRetryable`
   * defaults to "retry any thrown error"; narrow it if some failures (e.g. a
   * malformed transaction) should fail fast instead.
   */
  retry?: RetryOptions;
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

      const send = () => server.sendTransaction(tx);
      const res = options.retry ? await retryWithBackoff(send, options.retry) : await send();

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
