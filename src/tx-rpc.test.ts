import { describe, expect, it, vi } from "vitest";
import {
  createRpcTxSubmitter,
  RateLimitError,
  TokenBucket,
} from "./tx-rpc";

// Transaction.fromXDR(signedXdr, "base64") is called unconditionally before
// the injected `server` is ever touched. Stub it so these tests (which are
// only exercising the retry wiring, not XDR parsing) don't depend on the
// installed @stellar/stellar-sdk version's exact static API — a pre-existing,
// unrelated mismatch (see the tsc error on this line) that is out of scope
// for the #297 retry-utility work.
vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    Transaction: { fromXDR: vi.fn(() => ({}) as never) },
  };
});

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

  describe("retry (#297 — shared with balances-rpc.ts via ./rpc-retry)", () => {
    it("makes a single attempt when no retry option is given (pre-#297 behaviour)", async () => {
      const sendTransaction = vi.fn().mockRejectedValue(new Error("network blip"));
      const submitter = createRpcTxSubmitter({
        rpcUrl: "https://rpc.test",
        server: { sendTransaction } as never,
      });
      await expect(submitter.submitTransaction("AAAA")).rejects.toThrow("network blip");
      expect(sendTransaction).toHaveBeenCalledTimes(1);
    });

    it("retries sendTransaction on transient failure and succeeds", async () => {
      const sendTransaction = vi
        .fn()
        .mockRejectedValueOnce(new Error("network blip"))
        .mockResolvedValueOnce({ status: "PENDING", hash: "txhash123" });
      const submitter = createRpcTxSubmitter({
        rpcUrl: "https://rpc.test",
        server: { sendTransaction } as never,
        retry: { attempts: 3, sleep: vi.fn().mockResolvedValue(undefined) },
      });
      const result = await submitter.submitTransaction("AAAA");
      expect(result.hash).toBe("txhash123");
      expect(sendTransaction).toHaveBeenCalledTimes(2);
    });

    it("gives up and rejects once retry attempts are exhausted", async () => {
      const sendTransaction = vi.fn().mockRejectedValue(new Error("still down"));
      const submitter = createRpcTxSubmitter({
        rpcUrl: "https://rpc.test",
        server: { sendTransaction } as never,
        retry: { attempts: 2, sleep: vi.fn().mockResolvedValue(undefined) },
      });
      await expect(submitter.submitTransaction("AAAA")).rejects.toThrow("still down");
      expect(sendTransaction).toHaveBeenCalledTimes(2);
    });

    it("checks the rate limiter before retrying, not once per retry", async () => {
      const sendTransaction = vi.fn();
      const submitter = createRpcTxSubmitter({
        rpcUrl: "https://rpc.test",
        rateLimit: { bucketSize: 0, refillRate: 0 },
        server: { sendTransaction } as never,
        retry: { attempts: 3, sleep: vi.fn().mockResolvedValue(undefined) },
      });
      await expect(submitter.submitTransaction("AAAA")).rejects.toBeInstanceOf(RateLimitError);
      expect(sendTransaction).not.toHaveBeenCalled();
    });
  });
});
