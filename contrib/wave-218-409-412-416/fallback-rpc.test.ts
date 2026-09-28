import { describe, expect, it, vi } from "vitest";
import { rpc } from "@stellar/stellar-sdk";
import { createRpcTxStatusReaderWithFallback } from "./fallback-rpc";

describe("fallback RPC routing for tx status reader (#218)", () => {
  it("queries primary endpoint when healthy", async () => {
    const mockPrimary = {
      getTransaction: vi.fn().mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
      }),
    };
    const mockFallback = {
      getTransaction: vi.fn(),
    };

    const reader = createRpcTxStatusReaderWithFallback({
      rpcUrl: "https://primary-rpc.example.com",
      fallbackRpcUrls: ["https://fallback-rpc.example.com"],
      servers: [mockPrimary as any, mockFallback as any],
    });

    const status = await reader.getStatus("tx-123");
    expect(status).toBe("success");
    expect(mockPrimary.getTransaction).toHaveBeenCalledWith("tx-123");
    expect(mockFallback.getTransaction).not.toHaveBeenCalled();
  });

  it("falls back to next endpoint on primary failure/error", async () => {
    const mockPrimary = {
      getTransaction: vi.fn().mockRejectedValue(new Error("503 Service Unavailable")),
    };
    const mockFallback = {
      getTransaction: vi.fn().mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
      }),
    };

    const reader = createRpcTxStatusReaderWithFallback({
      rpcUrl: "https://primary-rpc.example.com",
      fallbackRpcUrls: ["https://fallback-rpc.example.com"],
      servers: [mockPrimary as any, mockFallback as any],
    });

    const status = await reader.getStatus("tx-123");
    expect(status).toBe("success");
    expect(mockPrimary.getTransaction).toHaveBeenCalledTimes(1);
    expect(mockFallback.getTransaction).toHaveBeenCalledWith("tx-123");
  });

  it("falls back to next endpoint on primary timeout", async () => {
    const mockPrimary = {
      getTransaction: vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100)),
      ),
    };
    const mockFallback = {
      getTransaction: vi.fn().mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.FAILED,
      }),
    };

    const reader = createRpcTxStatusReaderWithFallback({
      rpcUrl: "https://primary-rpc.example.com",
      fallbackRpcUrls: ["https://fallback-rpc.example.com"],
      timeoutMs: 15,
      servers: [mockPrimary as any, mockFallback as any],
    });

    const status = await reader.getStatus("tx-456");
    expect(status).toBe("failed");
    expect(mockFallback.getTransaction).toHaveBeenCalledWith("tx-456");
  });

  it("traverses multiple fallback endpoints sequentially", async () => {
    const mock1 = { getTransaction: vi.fn().mockRejectedValue(new Error("500 Internal Server Error")) };
    const mock2 = { getTransaction: vi.fn().mockRejectedValue(new Error("429 Too Many Requests")) };
    const mock3 = {
      getTransaction: vi.fn().mockResolvedValue({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
      }),
    };

    const reader = createRpcTxStatusReaderWithFallback({
      rpcUrl: "https://primary.example.com",
      fallbackRpcUrls: ["https://fb1.example.com", "https://fb2.example.com"],
      servers: [mock1 as any, mock2 as any, mock3 as any],
    });

    const status = await reader.getStatus("tx-multi");
    expect(status).toBe("success");
    expect(mock1.getTransaction).toHaveBeenCalledTimes(1);
    expect(mock2.getTransaction).toHaveBeenCalledTimes(1);
    expect(mock3.getTransaction).toHaveBeenCalledTimes(1);
  });

  it("throws when all endpoints fail", async () => {
    const mock1 = { getTransaction: vi.fn().mockRejectedValue(new Error("RPC 1 down")) };
    const mock2 = { getTransaction: vi.fn().mockRejectedValue(new Error("RPC 2 down")) };

    const reader = createRpcTxStatusReaderWithFallback({
      rpcUrl: "https://primary.example.com",
      fallbackRpcUrls: ["https://fb1.example.com"],
      servers: [mock1 as any, mock2 as any],
    });

    await expect(reader.getStatus("tx-fail")).rejects.toThrow("RPC 2 down");
  });
});
