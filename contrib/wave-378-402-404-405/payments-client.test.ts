import { describe, it, expect, vi } from "vitest";
import {
  createPaymentClient,
  InvalidRecipientError,
  RELAYER_MAX_TIMEOUT_SECONDS,
} from "../../src/payments-client";
import { InvalidAmountError } from "../../src/payments";

describe("payments-client tests (#405)", () => {
  const mockToken = {
    contractId: "C1234567890TOKEN",
    symbol: "USDC",
    decimals: 7,
  };

  it("prepares payment and executes confirm successfully", async () => {
    const mockTransfer = vi.fn().mockResolvedValue({ tx: "un-signed-tx" });
    const mockSac = {
      getSACClient: vi.fn().mockReturnValue({ transfer: mockTransfer }),
    };
    const mockKit = {
      sign: vi.fn().mockResolvedValue({ tx: "signed-tx" }),
    };
    const mockBackend = {
      submitTransaction: vi.fn().mockResolvedValue({ hash: "tx-hash-777" }),
    };
    const isValidAddress = vi.fn().mockReturnValue(true);

    const client = createPaymentClient({
      kit: mockKit,
      sac: mockSac,
      backend: mockBackend,
      network: "testnet",
      isValidAddress,
      signedToXdr: (signed) => `xdr-${(signed as any).tx}`,
    });

    const prepared = await client.preparePayment({
      from: "GUSER111",
      to: "GRECIPIENT222",
      token: mockToken,
      amount: 1000000n,
    });

    expect(prepared.review).toEqual({
      from: "GUSER111",
      to: "GRECIPIENT222",
      token: mockToken,
      amount: 1000000n,
      network: "testnet",
    });

    expect(mockSac.getSACClient).toHaveBeenCalledWith(mockToken.contractId);
    expect(mockTransfer).toHaveBeenCalledWith(
      { from: "GUSER111", to: "GRECIPIENT222", amount: 1000000n },
      { timeoutInSeconds: RELAYER_MAX_TIMEOUT_SECONDS }
    );

    const result = await prepared.confirm();
    expect(result).toEqual({ hash: "tx-hash-777" });
    expect(mockKit.sign).toHaveBeenCalled();
    expect(mockBackend.submitTransaction).toHaveBeenCalledWith({
      signedXdr: "xdr-signed-tx",
      network: "testnet",
    });
  });

  it("throws InvalidRecipientError when address is invalid", async () => {
    const client = createPaymentClient({
      kit: { sign: vi.fn() },
      sac: { getSACClient: vi.fn() },
      backend: { submitTransaction: vi.fn() },
      network: "testnet",
      isValidAddress: () => false,
    });

    await expect(
      client.preparePayment({
        from: "GUSER111",
        to: "invalid-addr",
        token: mockToken,
        amount: 1000n,
      })
    ).rejects.toThrow(InvalidRecipientError);
  });

  it("throws InvalidRecipientError when recipient equals sender", async () => {
    const client = createPaymentClient({
      kit: { sign: vi.fn() },
      sac: { getSACClient: vi.fn() },
      backend: { submitTransaction: vi.fn() },
      network: "testnet",
      isValidAddress: () => true,
    });

    await expect(
      client.preparePayment({
        from: "GUSER111",
        to: "GUSER111",
        token: mockToken,
        amount: 1000n,
      })
    ).rejects.toThrow(InvalidRecipientError);
  });

  it("throws InvalidAmountError when amount is zero or negative", async () => {
    const client = createPaymentClient({
      kit: { sign: vi.fn() },
      sac: { getSACClient: vi.fn() },
      backend: { submitTransaction: vi.fn() },
      network: "testnet",
      isValidAddress: () => true,
    });

    await expect(
      client.preparePayment({
        from: "GUSER111",
        to: "GRECIPIENT222",
        token: mockToken,
        amount: 0n,
      })
    ).rejects.toThrow(InvalidAmountError);
  });
});
