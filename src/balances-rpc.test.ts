import { describe, expect, it } from "vitest";
import { nativeToken } from "./balances-rpc";
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
