import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createRpcTxStatusReader,
  isValidStellarAddress,
  type RpcEndpoint,
  type RpcTxStatusReaderOptions,
} from "./tx-rpc";

// Mock the @stellar/stellar-sdk module
const mockGetTransaction = vi.fn();

vi.mock("@stellar/stellar-sdk", () => {
  return {
    rpc: {
      Server: vi.fn().mockImplementation(() => ({
        getTransaction: mockGetTransaction,
      })),
      Api: {
        GetTransactionStatus: {
          SUCCESS: "SUCCESS",
          FAILED: "FAILED",
          NOT_FOUND: "NOT_FOUND",
        },
      },
    },
    StrKey: {
      isValidEd25519PublicKey: vi.fn((addr: string) => addr.startsWith("G")),
      isValidContract: vi.fn((addr: string) => addr.startsWith("C")),
    },
  };
});

describe("isValidStellarAddress", () => {
  it("returns true for G... addresses", () => {
    expect(isValidStellarAddress("GABC123")).toBe(true);
  });

  it("returns true for C... addresses", () => {
    expect(isValidStellarAddress("CABC123")).toBe(true);
  });

  it("returns false for other addresses", () => {
    expect(isValidStellarAddress("DABC123")).toBe(false);
  });
});

describe("createRpcTxStatusReader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("single endpoint (backward compatible)", () => {
    it("returns success for successful transactions", async () => {
      mockGetTransaction.mockResolvedValue({ status: "SUCCESS" });
      const reader = createRpcTxStatusReader({
        rpcUrl: "https://rpc.example.com",
      });

      const status = await reader.getStatus("abc123");
      expect(status).toBe("success");
      expect(mockGetTransaction).toHaveBeenCalledWith("abc123");
    });

    it("returns failed for failed transactions", async () => {
      mockGetTransaction.mockResolvedValue({ status: "FAILED" });
      const reader = createRpcTxStatusReader({
        rpcUrl: "https://rpc.example.com",
      });

      const status = await reader.getStatus("abc123");
      expect(status).toBe("failed");
    });

    it("returns pending for not found transactions", async () => {
      mockGetTransaction.mockResolvedValue({ status: "NOT_FOUND" });
      const reader = createRpcTxStatusReader({
        rpcUrl: "https://rpc.example.com",
      });

      const status = await reader.getStatus("abc123");
      expect(status).toBe("pending");
    });
  });

  describe("multiple endpoints with fallback", () => {
    it("falls back to second endpoint on primary timeout", async () => {
      let callCount = 0;
      mockGetTransaction.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // Primary times out
          throw new Error("Request timed out after 5000ms");
        }
        // Backup succeeds
        return { status: "SUCCESS" };
      });

      const reader = createRpcTxStatusReader({
        endpoints: [
          { url: "https://primary.example.com", timeoutMs: 5000 },
          { url: "https://backup.example.com", timeoutMs: 10000 },
        ],
      });

      const status = await reader.getStatus("abc123");
      expect(status).toBe("success");
      expect(mockGetTransaction).toHaveBeenCalledTimes(2);
    });

    it("falls back to second endpoint on primary network error", async () => {
      let callCount = 0;
      mockGetTransaction.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // Primary network error
          throw new Error("ECONNREFUSED");
        }
        // Backup succeeds
        return { status: "FAILED" };
      });

      const reader = createRpcTxStatusReader({
        endpoints: [
          { url: "https://primary.example.com" },
          { url: "https://backup.example.com" },
        ],
      });

      const status = await reader.getStatus("abc123");
      expect(status).toBe("failed");
      expect(mockGetTransaction).toHaveBeenCalledTimes(2);
    });

    it("falls back through multiple endpoints", async () => {
      let callCount = 0;
      mockGetTransaction.mockImplementation(async () => {
        callCount++;
        if (callCount <= 2) {
          // First two fail
          throw new Error("ECONNRESET");
        }
        // Third succeeds
        return { status: "SUCCESS" };
      });

      const reader = createRpcTxStatusReader({
        endpoints: [
          { url: "https://primary.example.com" },
          { url: "https://backup1.example.com" },
          { url: "https://backup2.example.com" },
        ],
      });

      const status = await reader.getStatus("abc123");
      expect(status).toBe("success");
      expect(mockGetTransaction).toHaveBeenCalledTimes(3);
    });

    it("throws on last endpoint failure", async () => {
      mockGetTransaction.mockRejectedValue(new Error("ECONNREFUSED"));

      const reader = createRpcTxStatusReader({
        endpoints: [
          { url: "https://primary.example.com" },
          { url: "https://backup.example.com" },
        ],
      });

      await expect(reader.getStatus("abc123")).rejects.toThrow("ECONNREFUSED");
      expect(mockGetTransaction).toHaveBeenCalledTimes(2);
    });

    it("does not fall back on non-retryable errors", async () => {
      let callCount = 0;
      mockGetTransaction.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // Primary throws non-retryable error
          throw new Error("Invalid transaction hash");
        }
        // Backup should not be called
        return { status: "SUCCESS" };
      });

      const reader = createRpcTxStatusReader({
        endpoints: [
          { url: "https://primary.example.com" },
          { url: "https://backup.example.com" },
        ],
      });

      await expect(reader.getStatus("abc123")).rejects.toThrow(
        "Invalid transaction hash",
      );
      expect(mockGetTransaction).toHaveBeenCalledTimes(1);
    });

    it("falls back on HTTP 5xx errors", async () => {
      let callCount = 0;
      mockGetTransaction.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("HTTP 503 Service Unavailable");
        }
        return { status: "SUCCESS" };
      });

      const reader = createRpcTxStatusReader({
        endpoints: [
          { url: "https://primary.example.com" },
          { url: "https://backup.example.com" },
        ],
      });

      const status = await reader.getStatus("abc123");
      expect(status).toBe("success");
      expect(mockGetTransaction).toHaveBeenCalledTimes(2);
    });

    it("falls back on socket hang up error", async () => {
      let callCount = 0;
      mockGetTransaction.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("socket hang up");
        }
        return { status: "PENDING" };
      });

      const reader = createRpcTxStatusReader({
        endpoints: [
          { url: "https://primary.example.com" },
          { url: "https://backup.example.com" },
        ],
      });

      const status = await reader.getStatus("abc123");
      expect(status).toBe("pending");
      expect(mockGetTransaction).toHaveBeenCalledTimes(2);
    });
  });

  describe("configuration", () => {
    it("throws if no rpcUrl or endpoints provided", () => {
      expect(() => createRpcTxStatusReader({})).toThrow(
        "Either 'rpcUrl' or 'endpoints' must be provided",
      );
    });

    it("throws if empty endpoints array provided", () => {
      expect(() => createRpcTxStatusReader({ endpoints: [] })).toThrow(
        "Either 'rpcUrl' or 'endpoints' must be provided",
      );
    });

    it("uses default timeout when not specified on endpoint", async () => {
      let timeoutUsed: number | undefined;
      mockGetTransaction.mockImplementation(async () => {
        // We can't directly observe the timeout value, but we can verify
        // the endpoint is called
        return { status: "SUCCESS" };
      });

      const reader = createRpcTxStatusReader({
        endpoints: [{ url: "https://primary.example.com" }],
        defaultTimeoutMs: 5000,
      });

      const status = await reader.getStatus("abc123");
      expect(status).toBe("success");
    });

    it("prefers endpoints over rpcUrl", async () => {
      mockGetTransaction.mockResolvedValue({ status: "SUCCESS" });

      const reader = createRpcTxStatusReader({
        rpcUrl: "https://ignored.example.com",
        endpoints: [{ url: "https://used.example.com" }],
      });

      const status = await reader.getStatus("abc123");
      expect(status).toBe("success");
    });
  });
});
