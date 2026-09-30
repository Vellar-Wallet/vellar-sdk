/**
 * rpc-token-bucket.ts — Contributor reference implementation for #422 & #423.
 *
 * #422: Accept an already-constructed TokenBucket instance to share rate limits
 *       across submitters.
 * #423: Provide retry-after computation and explicit error classification.
 */

export class TokenBucket {
  private _tokens: number;
  private readonly _capacity: number;
  private readonly _refillPerMs: number;
  private _lastRefill: number;

  constructor(capacity: number, refillPerSecond: number) {
    if (capacity <= 0 || refillPerSecond <= 0) {
      throw new Error("TokenBucket capacity and refillPerSecond must be > 0");
    }
    this._capacity = capacity;
    this._tokens = capacity;
    this._refillPerMs = refillPerSecond / 1000;
    this._lastRefill = Date.now();
  }

  get tokens(): number {
    this._refill();
    return this._tokens;
  }

  private _refill(): void {
    const now = Date.now();
    const elapsed = now - this._lastRefill;
    this._tokens = Math.min(this._capacity, this._tokens + elapsed * this._refillPerMs);
    this._lastRefill = now;
  }

  tryConsume(cost: number = 1): boolean {
    this._refill();
    if (this._tokens >= cost) {
      this._tokens -= cost;
      return true;
    }
    return false;
  }

  msUntilNextToken(): number {
    this._refill();
    if (this._tokens >= 1) {
      return 0;
    }
    const deficit = 1 - this._tokens;
    return Math.ceil(deficit / this._refillPerMs);
  }
}

export class RateLimitError extends Error {
  readonly retryable = true as const;
  readonly retryAfterMs: number;
  readonly retryAfter: number;

  constructor(retryAfterMs: number) {
    super(`Rate limit exceeded; retry after ${retryAfterMs}ms`);
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
    this.retryAfter = Math.ceil(retryAfterMs / 1000);
  }
}

export class RpcRateLimitError extends Error {
  readonly status = 429 as const;
  readonly retryable = true as const;
  readonly retryAfterMs: number;
  readonly retryAfter: number;

  constructor(message: string, retryAfterMs: number = 1000) {
    super(message);
    this.name = "RpcRateLimitError";
    this.retryAfterMs = retryAfterMs;
    this.retryAfter = Math.ceil(retryAfterMs / 1000);
  }
}

export class RpcTransactionError extends Error {
  readonly status = "ERROR" as const;
  readonly retryable = false as const;
  readonly resultCode?: string;
  readonly errorResult?: unknown;

  constructor(message: string, resultCode?: string, errorResult?: unknown) {
    super(message);
    this.name = "RpcTransactionError";
    this.resultCode = resultCode;
    this.errorResult = errorResult;
  }
}

export interface RpcSubmitterOptionsInput {
  rateLimit?: {
    capacity: number;
    refillPerSecond: number;
  };
  bucket?: TokenBucket;
}

export function createRpcSubmitterConfig(options: RpcSubmitterOptionsInput): {
  bucket: TokenBucket;
} {
  if (options.bucket !== undefined && options.rateLimit !== undefined) {
    throw new Error(
      "Cannot specify both 'bucket' and 'rateLimit' in RpcTxSubmitterOptions. Provide one or the other.",
    );
  }

  if (options.bucket !== undefined) {
    return { bucket: options.bucket };
  }

  const capacity = options.rateLimit?.capacity ?? 10;
  const refill = options.rateLimit?.refillPerSecond ?? 2;
  return { bucket: new TokenBucket(capacity, refill) };
}
