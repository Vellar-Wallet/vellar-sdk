import { describe, expect, it, vi } from "vitest";
import { InvalidAmountError, parseTokenAmount } from "./payments";
import {
  createPaymentClient,
  InvalidRecipientError,
  type PaymentClientOptions,
  type SacClientLike,
} from "./payments-client";

describe("parseTokenAmount", () => {
  it.each([
    ["10000", 7, 100000000000n],
    ["1.0000001", 7, 10000001n],
    ["0.0000001", 7, 1n],
    ["1.2345", 7, 12345000n],
    ["  2.5  ", 7, 25000000n],
    ["42", 0, 42n],
  ])("parses %s with %s decimals to %s", (input, decimals, expected) => {
    expect(parseTokenAmount(input, decimals)).toBe(expected);
  });

  it.each([[""], ["  "], ["abc"], ["1.2.3"], ["-5"], ["1,5"], ["1e7"], [".5"]])(
    "rejects malformed input %j",
    (input) => {
      expect(() => parseTokenAmount(input, 7)).toThrow(InvalidAmountError);
    },
  );

  it("rejects zero", () => {
    expect(() => parseTokenAmount("0", 7)).toThrow(/greater than zero/);
    expect(() => parseTokenAmount("0.000", 7)).toThrow(/greater than zero/);
  });

  it("rejects more fractional digits than the token supports, never rounds", () => {
    expect(() => parseTokenAmount("1.00000001", 7)).toThrow(/at most 7 decimal places/);
  });

  it("rejects invalid decimals config", () => {
    expect(() => parseTokenAmount("1", -1)).toThrow(RangeError);
  });
});

const xlm = { symbol: "XLM", contractId: "CNATIVE", decimals: 7 };
const FROM = "CSMARTWALLET";
const TO = "GRECIPIENT";

function fakeSac(transfer = vi.fn().mockResolvedValue({ toXDR: () => "built-xdr" })): {
  sac: SacClientLike;
  transfer: ReturnType<typeof vi.fn>;
  getSACClient: ReturnType<typeof vi.fn>;
} {
  const getSACClient = vi.fn().mockReturnValue({ transfer });
  return { sac: { getSACClient }, transfer, getSACClient };
}

function clientWith(overrides: Partial<PaymentClientOptions> = {}) {
  const { sac, transfer, getSACClient } = fakeSac();
  const sign = vi.fn().mockResolvedValue({ toXDR: () => "signed-xdr" });
  const submitTransaction = vi.fn().mockResolvedValue({ hash: "txhash" });
  const client = createPaymentClient({
    kit: { sign },
    sac,
    backend: { submitTransaction },
    network: "testnet",
    isValidAddress: () => true,
    ...overrides,
  });
  return { client, sign, submitTransaction, transfer, getSACClient };
}

describe("createPaymentClient.preparePayment", () => {
  it("builds the transfer and returns the review payload", async () => {
    const { client, transfer, getSACClient } = clientWith();
    const prepared = await client.preparePayment({ from: FROM, to: TO, token: xlm, amount: 5n });

    expect(getSACClient).toHaveBeenCalledWith("CNATIVE");
    // timeoutInSeconds is mandatory: the relayer rejects timebounds > 60s.
    expect(transfer).toHaveBeenCalledWith(
      { from: FROM, to: TO, amount: 5n },
      { timeoutInSeconds: 30 },
    );
    expect(prepared.review).toEqual({
      from: FROM,
      to: TO,
      token: xlm,
      amount: 5n,
      network: "testnet",
    });
  });

  it("rejects an invalid recipient before building anything", async () => {
    const { client, transfer } = clientWith({ isValidAddress: () => false });
    await expect(
      client.preparePayment({ from: FROM, to: "junk", token: xlm, amount: 5n }),
    ).rejects.toBeInstanceOf(InvalidRecipientError);
    expect(transfer).not.toHaveBeenCalled();
  });

  it("rejects sending to the same account", async () => {
    const { client } = clientWith();
    await expect(
      client.preparePayment({ from: FROM, to: FROM, token: xlm, amount: 5n }),
    ).rejects.toThrow(/differ from the sending account/);
  });

  it("rejects non-positive amounts", async () => {
    const { client } = clientWith();
    await expect(
      client.preparePayment({ from: FROM, to: TO, token: xlm, amount: 0n }),
    ).rejects.toBeInstanceOf(InvalidAmountError);
  });

  it("surfaces simulation failures from the build step", async () => {
    const { sac } = fakeSac(vi.fn().mockRejectedValue(new Error("insufficient balance")));
    const { client } = clientWith({ sac });
    await expect(
      client.preparePayment({ from: FROM, to: TO, token: xlm, amount: 5n }),
    ).rejects.toThrow("insufficient balance");
  });
});

describe("PreparedPayment.confirm", () => {
  it("signs the built tx with the passkey and submits the XDR", async () => {
    const { client, sign, submitTransaction } = clientWith();
    const prepared = await client.preparePayment({ from: FROM, to: TO, token: xlm, amount: 5n });

    await expect(prepared.confirm()).resolves.toEqual({ hash: "txhash" });
    expect(sign).toHaveBeenCalledTimes(1);
    expect(submitTransaction).toHaveBeenCalledWith({ signedXdr: "signed-xdr", network: "testnet" });
  });

  it("uses the original tx when sign() returns nothing (in-place signing)", async () => {
    const { client, submitTransaction } = clientWith({
      kit: { sign: vi.fn().mockResolvedValue(undefined) },
    });
    const prepared = await client.preparePayment({ from: FROM, to: TO, token: xlm, amount: 5n });
    await prepared.confirm();
    expect(submitTransaction).toHaveBeenCalledWith({ signedXdr: "built-xdr", network: "testnet" });
  });

  it("does not submit when the user cancels the passkey prompt", async () => {
    const cancel = new Error("dismissed");
    cancel.name = "NotAllowedError";
    const { client, submitTransaction } = clientWith({
      kit: { sign: vi.fn().mockRejectedValue(cancel) },
    });
    const prepared = await client.preparePayment({ from: FROM, to: TO, token: xlm, amount: 5n });
    await expect(prepared.confirm()).rejects.toThrow("dismissed");
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it("propagates submission failures", async () => {
    const { client } = clientWith({
      backend: { submitTransaction: vi.fn().mockRejectedValue(new Error("relayer down")) },
    });
    const prepared = await client.preparePayment({ from: FROM, to: TO, token: xlm, amount: 5n });
    await expect(prepared.confirm()).rejects.toThrow("relayer down");
  });
});

// #240: exactly-once submission guard, keyed on a client-generated paymentId.
describe("PreparedPayment.confirm — exactly-once submission guard (#240)", () => {
  it("submits once for two sequential confirm() calls with the same paymentId", async () => {
    const { client, sign, submitTransaction } = clientWith();
    const prepared = await client.preparePayment({
      from: FROM,
      to: TO,
      token: xlm,
      amount: 5n,
      paymentId: "pay-1",
    });

    const first = await prepared.confirm();
    const second = await prepared.confirm();

    expect(first).toEqual({ hash: "txhash" });
    expect(second).toEqual({ hash: "txhash" });
    expect(sign).toHaveBeenCalledTimes(1);
    expect(submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("de-duplicates CONCURRENT confirm() calls (a UI double-submit) into one submission", async () => {
    let resolveSign!: (v: { toXDR(): string }) => void;
    const sign = vi.fn(() => new Promise<{ toXDR(): string }>((r) => (resolveSign = r)));
    const submitTransaction = vi.fn().mockResolvedValue({ hash: "txhash" });
    const { client } = clientWith({ kit: { sign }, backend: { submitTransaction } });
    const prepared = await client.preparePayment({
      from: FROM,
      to: TO,
      token: xlm,
      amount: 5n,
      paymentId: "pay-2",
    });

    // Two calls fired back-to-back, before the first has resolved.
    const p1 = prepared.confirm();
    const p2 = prepared.confirm();
    resolveSign({ toXDR: () => "signed-xdr" });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ hash: "txhash" });
    expect(r2).toEqual({ hash: "txhash" });
    expect(sign).toHaveBeenCalledTimes(1);
    expect(submitTransaction).toHaveBeenCalledTimes(1);
  });

  it("submits independently each call when no paymentId is given (opt-out, unchanged pre-#240 behavior)", async () => {
    const { client, sign, submitTransaction } = clientWith();
    const prepared = await client.preparePayment({ from: FROM, to: TO, token: xlm, amount: 5n });

    await prepared.confirm();
    await prepared.confirm();

    expect(sign).toHaveBeenCalledTimes(2);
    expect(submitTransaction).toHaveBeenCalledTimes(2);
  });

  it("does not permanently block retries after a FAILED submission under the same paymentId", async () => {
    const submitTransaction = vi
      .fn()
      .mockRejectedValueOnce(new Error("relayer down"))
      .mockResolvedValueOnce({ hash: "txhash-retry" });
    const { client, sign } = clientWith({ backend: { submitTransaction } });
    const prepared = await client.preparePayment({
      from: FROM,
      to: TO,
      token: xlm,
      amount: 5n,
      paymentId: "pay-3",
    });

    await expect(prepared.confirm()).rejects.toThrow("relayer down");
    await expect(prepared.confirm()).resolves.toEqual({ hash: "txhash-retry" });
    expect(sign).toHaveBeenCalledTimes(2);
    expect(submitTransaction).toHaveBeenCalledTimes(2);
  });

  it("keeps distinct paymentIds fully independent — each submits its own payment", async () => {
    const { client, sign, submitTransaction } = clientWith();
    const first = await client.preparePayment({
      from: FROM,
      to: TO,
      token: xlm,
      amount: 5n,
      paymentId: "pay-a",
    });
    const second = await client.preparePayment({
      from: FROM,
      to: TO,
      token: xlm,
      amount: 7n,
      paymentId: "pay-b",
    });

    await first.confirm();
    await second.confirm();

    expect(sign).toHaveBeenCalledTimes(2);
    expect(submitTransaction).toHaveBeenCalledTimes(2);
  });

  it("does not share submission state across separate PaymentClient instances", async () => {
    const { client: clientA, submitTransaction: submitA } = clientWith();
    const { client: clientB, submitTransaction: submitB } = clientWith();

    const preparedA = await clientA.preparePayment({
      from: FROM,
      to: TO,
      token: xlm,
      amount: 5n,
      paymentId: "shared-id",
    });
    const preparedB = await clientB.preparePayment({
      from: FROM,
      to: TO,
      token: xlm,
      amount: 5n,
      paymentId: "shared-id",
    });

    await preparedA.confirm();
    await preparedB.confirm();

    expect(submitA).toHaveBeenCalledTimes(1);
    expect(submitB).toHaveBeenCalledTimes(1);
  });
});
