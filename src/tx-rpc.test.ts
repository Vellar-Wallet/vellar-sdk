import { describe, expect, it, vi } from "vitest";
import { rpc } from "@stellar/stellar-sdk";
import { createRpcTxStatusReader, isValidStellarAddress } from "./tx-rpc";
import { RpcRequestError } from "./errors";

const HASH = "a".repeat(64);

describe("createRpcTxStatusReader", () => {
  it("maps SUCCESS/FAILED/NOT_FOUND to pending/success/failed", async () => {
    const reader = createRpcTxStatusReader({ rpcUrl: "https://rpc.test" });

    vi.spyOn(rpc.Server.prototype, "getTransaction").mockResolvedValueOnce({
      status: rpc.Api.GetTransactionStatus.SUCCESS,
    } as never);
    await expect(reader.getStatus(HASH)).resolves.toBe("success");

    vi.spyOn(rpc.Server.prototype, "getTransaction").mockResolvedValueOnce({
      status: rpc.Api.GetTransactionStatus.FAILED,
    } as never);
    await expect(reader.getStatus(HASH)).resolves.toBe("failed");

    vi.spyOn(rpc.Server.prototype, "getTransaction").mockResolvedValueOnce({
      status: rpc.Api.GetTransactionStatus.NOT_FOUND,
    } as never);
    await expect(reader.getStatus(HASH)).resolves.toBe("pending");
  });

  it("wraps an RPC network failure as a typed RpcRequestError", async () => {
    vi.spyOn(rpc.Server.prototype, "getTransaction").mockRejectedValueOnce(
      new TypeError("Failed to fetch"),
    );
    const reader = createRpcTxStatusReader({ rpcUrl: "https://rpc.test" });
    await expect(reader.getStatus(HASH)).rejects.toBeInstanceOf(RpcRequestError);
  });
});

describe("isValidStellarAddress", () => {
  it("accepts classic and contract addresses, rejects junk", () => {
    expect(isValidStellarAddress("GAJS3G2DMB25APEXHSR4SDHZFRZFAW5RTRWDQQ5R2L3AUJSKHQ2GKEPA")).toBe(
      true,
    );
    expect(isValidStellarAddress("CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND")).toBe(
      true,
    );
    expect(isValidStellarAddress("not-an-address")).toBe(false);
  });
});
