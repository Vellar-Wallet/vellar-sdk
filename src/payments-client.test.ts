import { describe, expect, it, vi } from "vitest";
import type { TokenInfo } from "./balances";
import { InvalidAmountError } from "./payments";
import {
  createPaymentClient,
  InvalidRecipientError,
  RELAYER_MAX_TIMEOUT_SECONDS,
} from "./payments-client";

const token: TokenInfo = { contractId: "CTOKEN", symbol: "XLM", decimals: 7 };
const from = "CSENDER";
const to = "CRECIPIENT";

function fakeKit() {
  return {
    sign: vi.fn(async (tx: unknown) => `signed-${String(tx)}`),
  };
}

function fakeBackend() {
  return {
    submitTransaction: vi.fn(async () => ({ hash: "txhash-12345" })),
  };
}

function fakeSac() {
  const transfer = vi.fn(async () => "built-and-simulated-transfer-xdr");
  return {
    getSACClient: vi.fn(() => ({ transfer })),
    _transfer: transfer,
  };
}

function buildClient() {
  const kit = fakeKit();
  const backend = fakeBackend();
  const sac = fakeSac();
  const isValidAddress = vi.fn((addr: string) => addr.startsWith("C"));
  const client = createPaymentClient({
    kit,
    sac,
    backend,
    network: "testnet",
    isValidAddress,
  });
  return { client, kit, backend, sac, isValidAddress };
}

describe("createPaymentClient", () => {
  it("happy path: prepares payment and confirm() signs and submits", async () => {
    const { client, kit, backend, sac } = buildClient();

    const prepared = await client.preparePayment({
      from,
      to,
      token,
      amount: 100_0000000n,
    });

    expect(prepared.review).toEqual({
      from,
      to,
      token,
      amount: 100_0000000n,
      network: "testnet",
    });

    // Verify simulation/build happened during preparePayment
    expect(sac.getSACClient).toHaveBeenCalledWith("CTOKEN");
    expect(sac._transfer).toHaveBeenCalledWith(
      { from, to, amount: 100_0000000n },
      { timeoutInSeconds: RELAYER_MAX_TIMEOUT_SECONDS },
    );

    // Confirm has not been called yet -> kit.sign must NOT be called yet
    expect(kit.sign).not.toHaveBeenCalled();

    // Now confirm the payment
    const result = await prepared.confirm();

    expect(result).toEqual({ hash: "txhash-12345" });
    expect(kit.sign).toHaveBeenCalledWith("built-and-simulated-transfer-xdr");
    expect(backend.submitTransaction).toHaveBeenCalledWith({
      signedXdr: "signed-built-and-simulated-transfer-xdr",
      network: "testnet",
    });
  });

  it("asserts simulation happens BEFORE any signing call", async () => {
    const { client, kit, sac } = buildClient();
    const callOrder: string[] = [];

    sac._transfer.mockImplementation(async () => {
      callOrder.push("sac-transfer-simulated");
      return "built-xdr";
    });
    kit.sign.mockImplementation(async () => {
      callOrder.push("kit-sign");
      return "signed-xdr";
    });

    const prepared = await client.preparePayment({ from, to, token, amount: 50n });

    expect(callOrder).toEqual(["sac-transfer-simulated"]);

    await prepared.confirm();

    expect(callOrder).toEqual(["sac-transfer-simulated", "kit-sign"]);
  });

  it("rejects an invalid recipient according to isValidAddress and does not simulate or sign", async () => {
    const { client, kit, sac, isValidAddress } = buildClient();
    isValidAddress.mockReturnValue(false);

    await expect(
      client.preparePayment({
        from,
        to: "INVALID_ADDRESS",
        token,
        amount: 100n,
      }),
    ).rejects.toBeInstanceOf(InvalidRecipientError);

    expect(sac.getSACClient).not.toHaveBeenCalled();
    expect(kit.sign).not.toHaveBeenCalled();
  });

  it("rejects recipient when recipient equals sending account and does not simulate or sign", async () => {
    const { client, kit, sac } = buildClient();

    await expect(
      client.preparePayment({
        from: "CSAMEACCOUNT",
        to: "CSAMEACCOUNT",
        token,
        amount: 100n,
      }),
    ).rejects.toThrow("Recipient must differ from the sending account");

    expect(sac.getSACClient).not.toHaveBeenCalled();
    expect(kit.sign).not.toHaveBeenCalled();
  });

  it("rejects non-positive payment amounts and does not simulate or sign", async () => {
    const { client, kit, sac } = buildClient();

    await expect(
      client.preparePayment({ from, to, token, amount: 0n }),
    ).rejects.toBeInstanceOf(InvalidAmountError);

    await expect(
      client.preparePayment({ from, to, token, amount: -10n }),
    ).rejects.toBeInstanceOf(InvalidAmountError);

    expect(sac.getSACClient).not.toHaveBeenCalled();
    expect(kit.sign).not.toHaveBeenCalled();
  });

  it("surfaces simulation failure as typed error before asking user to sign", async () => {
    const { client, kit, sac } = buildClient();
    const simError = new Error("Error(Contract, #10): Insufficient balance");
    sac._transfer.mockRejectedValue(simError);

    await expect(
      client.preparePayment({ from, to, token, amount: 1_000_000n }),
    ).rejects.toBe(simError);

    expect(kit.sign).not.toHaveBeenCalled();
  });

  it("surfaces submission failure after successful signature, establishing signature was produced", async () => {
    const { client, kit, backend } = buildClient();
    backend.submitTransaction.mockRejectedValue(new Error("Relayer error: tx expired"));

    const prepared = await client.preparePayment({ from, to, token, amount: 10n });

    expect(kit.sign).not.toHaveBeenCalled();

    await expect(prepared.confirm()).rejects.toThrow("Relayer error: tx expired");

    // Assert that signing DID complete before submission failed
    expect(kit.sign).toHaveBeenCalledTimes(1);
    expect(backend.submitTransaction).toHaveBeenCalledTimes(1);
  });
});
