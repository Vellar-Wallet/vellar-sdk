import { describe, expect, it, vi } from "vitest";
import {
  createRpcTxSubmitter,
  RateLimitError,
  TokenBucket,
} from "./tx-rpc";

describe("TokenBucket", () => {
  it("allows burst calls up to bucket size then rejects", () => {
    let now = 0;
    const bucket = new TokenBucket(3, 1 / 1000, () => now);

    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });

  it("refills tokens over time", () => {
    let now = 0;
    const bucket = new TokenBucket(2, 2 / 1000, () => now);

    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);

    now = 500;
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });
});

describe("createRpcTxSubmitter", () => {
  it("rejects excess submissions before hitting the network", async () => {
    const sendTransaction = vi.fn();
    const submitter = createRpcTxSubmitter({
      rpcUrl: "https://rpc.test",
      rateLimit: { bucketSize: 0, refillRate: 0 },
      server: { sendTransaction } as never,
    });

    await expect(submitter.submitTransaction("AAAA")).rejects.toBeInstanceOf(RateLimitError);
    expect(sendTransaction).not.toHaveBeenCalled();
  });
});
