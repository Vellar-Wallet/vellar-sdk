import { describe, expect, it, vi } from "vitest";
import {
  RateLimitError,
  RpcRateLimitError,
  RpcTransactionError,
  TokenBucket,
  createRpcSubmitterConfig,
} from "./rpc-token-bucket.js";

describe("TokenBucket (Issue #422 & #423)", () => {
  it("consumes available tokens and returns remaining count", () => {
    const bucket = new TokenBucket(5, 1);
    expect(bucket.tryConsume(1)).toBe(true);
    expect(bucket.tryConsume(2)).toBe(true);
    expect(bucket.tokens).toBeCloseTo(2, 1);
  });

  it("calculates msUntilNextToken correctly on deficit", () => {
    // 2 tokens capacity, refill 1 token every 1000ms (refillPerMs = 0.001)
    const bucket = new TokenBucket(2, 1);
    expect(bucket.tryConsume(2)).toBe(true);
    // Tokens is now 0. Deficit to reach 1 token is 1 token -> 1 / 0.001 = 1000ms
    const wait = bucket.msUntilNextToken();
    expect(wait).toBeGreaterThanOrEqual(950);
    expect(wait).toBeLessThanOrEqual(1005);
  });

  it("returns 0 wait time when tokens are readily available", () => {
    const bucket = new TokenBucket(2, 1);
    expect(bucket.msUntilNextToken()).toBe(0);
  });
});

describe("createRpcSubmitterConfig (Issue #422 & #423)", () => {
  it("allows sharing a single TokenBucket instance across submitters", () => {
    const sharedBucket = new TokenBucket(1, 0.1);
    const config1 = createRpcSubmitterConfig({ bucket: sharedBucket });
    const config2 = createRpcSubmitterConfig({ bucket: sharedBucket });

    expect(config1.bucket).toBe(sharedBucket);
    expect(config2.bucket).toBe(sharedBucket);

    expect(config1.bucket.tryConsume(1)).toBe(true);
    // Exhausted across all submitters sharing this bucket
    expect(config2.bucket.tryConsume(1)).toBe(false);
  });

  it("rejects passing both bucket and rateLimit", () => {
    const sharedBucket = new TokenBucket(1, 1);
    expect(() =>
      createRpcSubmitterConfig({
        bucket: sharedBucket,
        rateLimit: { capacity: 2, refillPerSecond: 1 },
      }),
    ).toThrow(/Cannot specify both 'bucket' and 'rateLimit'/);
  });

  it("exposes retryAfter, retryAfterMs, and retryable on RateLimitError", () => {
    const bucket = new TokenBucket(1, 1);
    bucket.tryConsume(1);
    const waitMs = bucket.msUntilNextToken();
    const err = new RateLimitError(waitMs);

    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(waitMs);
    expect(err.retryAfter).toBe(Math.ceil(waitMs / 1000));
  });

  it("marks RpcRateLimitError as retryable and status 429", () => {
    const err = new RpcRateLimitError("Upstream rate limited", 1500);
    expect(err.status).toBe(429);
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(1500);
    expect(err.retryAfter).toBe(2);
  });

  it("marks RpcTransactionError as non-retryable and exposes resultCode", () => {
    const err = new RpcTransactionError("txBadSeq", "txBadSeq", { code: "txBadSeq" });
    expect(err.status).toBe("ERROR");
    expect(err.resultCode).toBe("txBadSeq");
    expect(err.retryable).toBe(false);
  });
});
