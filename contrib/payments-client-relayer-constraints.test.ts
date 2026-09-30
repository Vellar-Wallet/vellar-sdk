import { describe, it, expect, vi } from "vitest";
import {
  createPaymentClient,
  InvalidRecipientError,
  RELAYER_MAX_TIMEOUT_SECONDS,
  type PaymentClientOptions,
} from "../src/payments-client";
import { InvalidAmountError } from "../src/payments";

// Direct unit tests for src/payments-client.ts, addressing the ask: assert the
// relayer timeout is passed on every transfer path (not just observed once via
// payments.test.ts), cover the InvalidRecipientError/InvalidAmountError
// boundaries, and prove confirm() is the only path that can submit — never
// preparePayment on its own.
//
// RELAYER_MAX_TIMEOUT_SECONDS exists because the OpenZeppelin Relayer rejects
// timeBounds.maxTime more than 60s out (error 7002) while sac-sdk defaults to
// 300s. If a refactor ever drops the explicit option, sac-sdk's default comes
// back silently and the relayer starts rejecting far from the point of change
// — these tests exist to catch that at the source.

const token = { contractId: "CTOKEN000000000000000000000000000000000000000000", symbol: "USDC", decimals: 7 };

function makeDeps(overrides: Partial<PaymentClientOptions> = {}) {
  const transfer = vi.fn().mockResolvedValue({ tx: "unsigned" });
  const sac = { getSACClient: vi.fn().mockReturnValue({ transfer }) };
  const sign = vi.fn().mockResolvedValue({ tx: "signed" });
  const kit = { sign };
  const submitTransaction = vi.fn().mockResolvedValue({ hash: "hash-1" });
  const backend = { submitTransaction };
  const isValidAddress = vi.fn().mockReturnValue(true);

  const options: PaymentClientOptions = {
    kit,
    sac,
    backend,
    network: "testnet",
    isValidAddress,
    signedToXdr: (signed) => `xdr-${(signed as { tx: string }).tx}`,
    ...overrides,
  };
  return { options, transfer, sac, sign, kit, submitTransaction, backend, isValidAddress };
}

describe("payments-client: relayer timeout on every transfer path", () => {
  const cases: Array<{ name: string; from: string; to: string; amount: bigint }> = [
    { name: "small amount", from: "GFROM1", to: "GTO1", amount: 1n },
    { name: "large amount", from: "GFROM2", to: "GTO2", amount: 9_999_999_999n },
    { name: "different token/account pair", from: "GFROM3", to: "GTO3", amount: 1_000_000n },
  ];

  for (const { name, from, to, amount } of cases) {
    it(`passes timeoutInSeconds on preparePayment (${name})`, async () => {
      const { options, transfer } = makeDeps();
      const client = createPaymentClient(options);

      await client.preparePayment({ from, to, token, amount });

      expect(transfer).toHaveBeenCalledTimes(1);
      expect(transfer).toHaveBeenCalledWith(
        { from, to, amount },
        { timeoutInSeconds: RELAYER_MAX_TIMEOUT_SECONDS },
      );
    });
  }

  it("RELAYER_MAX_TIMEOUT_SECONDS stays within the relayer's 60s ceiling", () => {
    // Documents the constraint the constant encodes so a future edit that
    // pushes it past the relayer's hard limit fails loudly here.
    expect(RELAYER_MAX_TIMEOUT_SECONDS).toBeLessThan(60);
    expect(RELAYER_MAX_TIMEOUT_SECONDS).toBeGreaterThan(0);
  });
});

describe("payments-client: InvalidRecipientError boundaries", () => {
  it("throws when the recipient address fails validation", async () => {
    const { options } = makeDeps({ isValidAddress: () => false });
    const client = createPaymentClient(options);

    await expect(
      client.preparePayment({ from: "GFROM", to: "not-an-address", token, amount: 100n }),
    ).rejects.toThrow(InvalidRecipientError);
  });

  it("throws when the recipient equals the sender, even though the address is valid", async () => {
    const { options, isValidAddress } = makeDeps();
    const client = createPaymentClient(options);

    await expect(
      client.preparePayment({ from: "GSAME", to: "GSAME", token, amount: 100n }),
    ).rejects.toThrow(InvalidRecipientError);
    expect(isValidAddress).toHaveBeenCalledWith("GSAME");
  });

  it("never reaches the SAC client when the recipient is rejected", async () => {
    const { options, sac } = makeDeps({ isValidAddress: () => false });
    const client = createPaymentClient(options);

    await expect(
      client.preparePayment({ from: "GFROM", to: "bad", token, amount: 100n }),
    ).rejects.toThrow(InvalidRecipientError);
    expect(sac.getSACClient).not.toHaveBeenCalled();
  });
});

describe("payments-client: InvalidAmountError boundaries", () => {
  it("throws on a zero amount", async () => {
    const { options } = makeDeps();
    const client = createPaymentClient(options);

    await expect(
      client.preparePayment({ from: "GFROM", to: "GTO", token, amount: 0n }),
    ).rejects.toThrow(InvalidAmountError);
  });

  it("throws on a negative amount", async () => {
    const { options } = makeDeps();
    const client = createPaymentClient(options);

    await expect(
      client.preparePayment({ from: "GFROM", to: "GTO", token, amount: -1n }),
    ).rejects.toThrow(InvalidAmountError);
  });

  it("never reaches the SAC client when the amount is invalid", async () => {
    const { options, sac } = makeDeps();
    const client = createPaymentClient(options);

    await expect(
      client.preparePayment({ from: "GFROM", to: "GTO", token, amount: 0n }),
    ).rejects.toThrow(InvalidAmountError);
    expect(sac.getSACClient).not.toHaveBeenCalled();
  });
});

describe("payments-client: confirm() gates submission behind explicit review", () => {
  it("does not sign or submit anything during preparePayment itself", async () => {
    const { options, sign, submitTransaction } = makeDeps();
    const client = createPaymentClient(options);

    await client.preparePayment({ from: "GFROM", to: "GTO", token, amount: 100n });

    expect(sign).not.toHaveBeenCalled();
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it("only signs and submits once confirm() is explicitly called", async () => {
    const { options, sign, submitTransaction } = makeDeps();
    const client = createPaymentClient(options);

    const prepared = await client.preparePayment({ from: "GFROM", to: "GTO", token, amount: 100n });
    expect(sign).not.toHaveBeenCalled();
    expect(submitTransaction).not.toHaveBeenCalled();

    const result = await prepared.confirm();

    expect(sign).toHaveBeenCalledTimes(1);
    expect(submitTransaction).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ hash: "hash-1" });
  });

  it("exposes the review the caller must show the user before confirm() can be called", async () => {
    const { options } = makeDeps();
    const client = createPaymentClient(options);

    const prepared = await client.preparePayment({
      from: "GFROM",
      to: "GTO",
      token,
      amount: 100n,
    });

    expect(prepared.review).toEqual({
      from: "GFROM",
      to: "GTO",
      token,
      amount: 100n,
      network: "testnet",
    });
  });
});
