import { describe, expect, it, vi } from "vitest";
import { rpc } from "@stellar/stellar-sdk";
import { createRpcBalanceReader, nativeToken } from "./balances-rpc";
import { RpcRequestError } from "./errors";

const HOLDER = "GAJS3G2DMB25APEXHSR4SDHZFRZFAW5RTRWDQQ5R2L3AUJSKHQ2GKEPA";
const TOKEN = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";
const PASSPHRASE = "Test SDF Network ; September 2015";

describe("createRpcBalanceReader", () => {
  it("wraps a simulation-rejected read as a typed RpcRequestError", async () => {
    vi.spyOn(rpc.Server.prototype, "simulateTransaction").mockRejectedValueOnce(
      new Error("connection refused"),
    );
    const reader = createRpcBalanceReader({ rpcUrl: "https://rpc.test", networkPassphrase: PASSPHRASE });
    await expect(reader.getTokenBalance(TOKEN, HOLDER)).rejects.toBeInstanceOf(RpcRequestError);
  });

  it("wraps a failed simulation result as a typed RpcRequestError", async () => {
    vi.spyOn(rpc.Server.prototype, "simulateTransaction").mockResolvedValueOnce({
      error: "host invocation failed",
    } as unknown as Awaited<ReturnType<typeof rpc.Server.prototype.simulateTransaction>>);
    const reader = createRpcBalanceReader({ rpcUrl: "https://rpc.test", networkPassphrase: PASSPHRASE });
    await expect(reader.getTokenBalance(TOKEN, HOLDER)).rejects.toThrow(RpcRequestError);
  });
});

describe("nativeToken", () => {
  it("derives the XLM SAC id for a network passphrase", () => {
    const token = nativeToken(PASSPHRASE);
    expect(token.symbol).toBe("XLM");
    expect(token.decimals).toBe(7);
    expect(token.contractId).toMatch(/^C/);
  });
});
