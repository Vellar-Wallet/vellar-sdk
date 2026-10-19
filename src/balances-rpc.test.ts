import { nativeToScVal, rpc } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRpcBalanceReader, InvalidTokenContractError, nativeToken } from "./balances-rpc";
import { MAINNET, TESTNET } from "./config";

describe("nativeToken", () => {
  it("derives the XLM SAC correctly", () => {
    const token = nativeToken(TESTNET.networkPassphrase);
    expect(token.symbol).toBe("XLM");
    expect(token.decimals).toBe(7);
    expect(token.contractId).toBe(TESTNET.nativeTokenContractId);
  });

  it("is network-specific — the SAC id differs per passphrase", () => {
    // XLM is the same asset on both networks but its SAC id is not: the
    // passphrase is an input to the derivation. Pinning both here guards a
    // caller who passes the wrong passphrase and reads balances from the
    // wrong network's contract.
    expect(nativeToken(MAINNET.networkPassphrase).contractId).toBe(MAINNET.nativeTokenContractId);
    expect(nativeToken(TESTNET.networkPassphrase).contractId).not.toBe(
      nativeToken(MAINNET.networkPassphrase).contractId,
    );
  });
});

const HOLDER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const NOT_A_TOKEN = MAINNET.nativeTokenContractId;

function reader() {
  return createRpcBalanceReader({
    rpcUrl: TESTNET.rpcUrl,
    networkPassphrase: TESTNET.networkPassphrase,
  });
}

function simulateSpy() {
  return vi.spyOn(rpc.Server.prototype, "simulateTransaction");
}

function simSuccess(retval: unknown) {
  return {
    transactionData: {},
    result: { retval },
  } as unknown as rpc.Api.SimulateTransactionResponse;
}

function simError(error: string) {
  return { error } as unknown as rpc.Api.SimulateTransactionResponse;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createRpcBalanceReader.getTokenBalance", () => {
  it("returns the balance on a successful simulation", async () => {
    simulateSpy().mockResolvedValue(simSuccess(nativeToScVal(123n, { type: "i128" })));
    await expect(reader().getTokenBalance(NOT_A_TOKEN, HOLDER)).resolves.toBe(123n);
  });

  it("throws InvalidTokenContractError when the contract has no balance method, without retrying", async () => {
    const sim = simulateSpy().mockResolvedValue(
      simError(
        "HostError: Error(WasmVm, MissingValue)\n trying to invoke non-existent contract function `balance`",
      ),
    );
    const err = await reader()
      .getTokenBalance(NOT_A_TOKEN, HOLDER)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidTokenContractError);
    expect((err as InvalidTokenContractError).name).toBe("InvalidTokenContractError");
    expect((err as InvalidTokenContractError).contractId).toBe(NOT_A_TOKEN);
    expect((err as Error).message).toMatch(/SEP-41/);
    expect(sim).toHaveBeenCalledTimes(1);
  });

  it("throws InvalidTokenContractError when balance returns a non-numeric value", async () => {
    simulateSpy().mockResolvedValue(simSuccess(nativeToScVal("not a number", { type: "string" })));
    await expect(reader().getTokenBalance(NOT_A_TOKEN, HOLDER)).rejects.toBeInstanceOf(
      InvalidTokenContractError,
    );
  });

  it("keeps an RPC outage distinct from a wrong-interface contract", async () => {
    simulateSpy().mockRejectedValue(new Error("fetch failed"));
    const err = await reader()
      .getTokenBalance(NOT_A_TOKEN, HOLDER)
      .catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(InvalidTokenContractError);
    expect((err as Error).message).toBe("fetch failed");
  });

  it("keeps other simulation failures distinct from a wrong-interface contract", async () => {
    simulateSpy().mockResolvedValue(simError("HostError: Error(Contract, #1) insufficient"));
    const err = await reader()
      .getTokenBalance(NOT_A_TOKEN, HOLDER)
      .catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(InvalidTokenContractError);
    expect((err as Error).message).toMatch(/Balance read failed/);
  });
});

describe("createRpcBalanceReader.getTokenDecimals", () => {
  it("reads decimals from the token contract", async () => {
    simulateSpy().mockResolvedValue(simSuccess(nativeToScVal(6, { type: "u32" })));
    await expect(reader().getTokenDecimals(NOT_A_TOKEN)).resolves.toBe(6);
  });

  it("throws InvalidTokenContractError when the contract has no decimals method", async () => {
    simulateSpy().mockResolvedValue(
      simError("trying to invoke non-existent contract function `decimals`"),
    );
    await expect(reader().getTokenDecimals(NOT_A_TOKEN)).rejects.toBeInstanceOf(
      InvalidTokenContractError,
    );
  });
});
