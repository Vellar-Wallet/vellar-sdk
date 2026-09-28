import { rpc, StrKey, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import type { TxStatus, TxStatusReader } from "./tx-status";

// RPC-backed pieces of the payment flow (subpath export — see rpc.ts).

/** Accepts classic (G...) and contract (C...) addresses. */
export function isValidStellarAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address) || StrKey.isValidContract(address);
}

export interface RpcTxStatusReaderOptions {
  /** Primary RPC endpoint URL. */
  rpcUrl: string;
  /** Prioritized list of fallback RPC endpoints used when the primary errors or times out (#218). */
  fallbackRpcUrls?: string[];
  /** Optional per-endpoint timeout in milliseconds. */
  timeoutMs?: number;
  /** Injected RPC servers (for testing). When provided, replaces default rpc.Server instantiation. */
  servers?: Pick<rpc.Server, "getTransaction">[];
}

async function withTimeout<T>(promise: Promise<T>, ms: number, url: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`RPC request to ${url} timed out after ${ms}ms`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createRpcTxStatusReader(options: RpcTxStatusReaderOptions): TxStatusReader {
  const urls = [options.rpcUrl, ...(options.fallbackRpcUrls ?? [])];
  const servers: Pick<rpc.Server, "getTransaction">[] =
    options.servers ??
    urls.map((url) => new rpc.Server(url, options.timeoutMs ? { timeout: options.timeoutMs } : undefined));

  return {
    async getStatus(hash): Promise<TxStatus> {
      let lastError: unknown;

      for (let i = 0; i < servers.length; i++) {
        const server = servers[i]!;
        try {
          const fetchPromise = server.getTransaction(hash);
          const res = options.timeoutMs
            ? await withTimeout(fetchPromise, options.timeoutMs, urls[i] ?? `endpoint #${i}`)
            : await fetchPromise;

          switch (res.status) {
            case rpc.Api.GetTransactionStatus.SUCCESS:
              return "success";
            case rpc.Api.GetTransactionStatus.FAILED:
              return "failed";
            default:
              // NOT_FOUND: not yet included in a ledger.
              return "pending";
          }
        } catch (err) {
          lastError = err;
          // Failover: route to the next prioritized endpoint on error or timeout
        }
      }

      throw lastError ?? new Error("All configured RPC endpoints failed to fetch transaction status");
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
      const tx = TransactionBuilder.fromXDR(signedXdr, "") as Transaction;
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
