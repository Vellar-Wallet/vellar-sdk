import { describe, expect, it, vi } from "vitest";
import { rpc } from "@stellar/stellar-sdk";
import {
  createRpcTxStatusReader,
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

describe("createRpcTxStatusReader fallback routing (#218)", () => {
  it("routes read to primary endpoint when healthy", async () => {
    const primary = {
      getTransaction: vi.fn().mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
      }),
    };
    const fallback = {
      getTransaction: vi.fn(),
    };

    const reader = createRpcTxStatusReader({
      rpcUrl: "https://rpc1.test",
      fallbackRpcUrls: ["https://rpc2.test"],
      servers: [primary, fallback],
    });

    const status = await reader.getStatus("tx123");
    expect(status).toBe("success");
    expect(primary.getTransaction).toHaveBeenCalledWith("tx123");
    expect(fallback.getTransaction).not.toHaveBeenCalled();
  });

  it("routes read to next fallback endpoint when primary fails with error", async () => {
    const primary = {
      getTransaction: vi.fn().mockRejectedValue(new Error("503 Service Unavailable")),
    };
    const fallback = {
      getTransaction: vi.fn().mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.FAILED,
      }),
    };

    const reader = createRpcTxStatusReader({
      rpcUrl: "https://rpc1.test",
      fallbackRpcUrls: ["https://rpc2.test"],
      servers: [primary, fallback],
    });

    const status = await reader.getStatus("tx123");
    expect(status).toBe("failed");
    expect(primary.getTransaction).toHaveBeenCalledTimes(1);
    expect(fallback.getTransaction).toHaveBeenCalledTimes(1);
    expect(fallback.getTransaction).toHaveBeenCalledWith("tx123");
  });

  it("routes read to fallback endpoint when primary times out", async () => {
    const primary = {
      getTransaction: vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 200)),
      ),
    };
    const fallback = {
      getTransaction: vi.fn().mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
      }),
    };

    const reader = createRpcTxStatusReader({
      rpcUrl: "https://rpc1.test",
      fallbackRpcUrls: ["https://rpc2.test"],
      timeoutMs: 20,
      servers: [primary, fallback],
    });

    const status = await reader.getStatus("tx123");
    expect(status).toBe("success");
    expect(primary.getTransaction).toHaveBeenCalledTimes(1);
    expect(fallback.getTransaction).toHaveBeenCalledTimes(1);
  });

  it("traverses prioritized fallback list sequentially until one succeeds", async () => {
    const primary = {
      getTransaction: vi.fn().mockRejectedValue(new Error("RPC 1 down")),
    };
    const fallback1 = {
      getTransaction: vi.fn().mockRejectedValue(new Error("RPC 2 degraded")),
    };
    const fallback2 = {
      getTransaction: vi.fn().mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.NOT_FOUND,
      }),
    };

    const reader = createRpcTxStatusReader({
      rpcUrl: "https://rpc1.test",
      fallbackRpcUrls: ["https://rpc2.test", "https://rpc3.test"],
      servers: [primary, fallback1, fallback2],
    });

    const status = await reader.getStatus("tx_hash");
    expect(status).toBe("pending");
    expect(primary.getTransaction).toHaveBeenCalledTimes(1);
    expect(fallback1.getTransaction).toHaveBeenCalledTimes(1);
    expect(fallback2.getTransaction).toHaveBeenCalledTimes(1);
  });

  it("throws the last error if all configured endpoints fail", async () => {
    const primary = {
      getTransaction: vi.fn().mockRejectedValue(new Error("RPC 1 failure")),
    };
    const fallback = {
      getTransaction: vi.fn().mockRejectedValue(new Error("RPC 2 failure")),
    };

    const reader = createRpcTxStatusReader({
      rpcUrl: "https://rpc1.test",
      fallbackRpcUrls: ["https://rpc2.test"],
      servers: [primary, fallback],
    });

    await expect(reader.getStatus("tx123")).rejects.toThrow("RPC 2 failure");
  });
});
