import { describe, expect, it, vi } from "vitest";
import { InvalidAmountError, parseTokenAmount } from "./payments";
import {
  createPaymentClient,
  InvalidRecipientError,
  TokenDecimalsMismatchError,
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

describe("parseTokenAmount sub-stroop rounding mode (reject, never round)", () => {
  it.each([["0.00000015"], ["0.00000019"], ["0.00000011"], ["1.00000005"], ["0.99999999"]])(
    "rejects %s instead of truncating or rounding it",
    (input) => {
      expect(() => parseTokenAmount(input, 7)).toThrow(InvalidAmountError);
      expect(() => parseTokenAmount(input, 7)).toThrow(/at most 7 decimal places/);
    },
  );

  it("accepts the smallest representable amounts exactly", () => {
    expect(parseTokenAmount("0.0000001", 7)).toBe(1n);
    expect(parseTokenAmount("0.0000015", 7)).toBe(15n);
  });

  it("rejects number inputs rather than coercing them, so strings and numbers behave alike", () => {
    for (const n of [0.00000015, 1.5, 5, 1e-7, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => parseTokenAmount(n as unknown as string, 7)).toThrow(InvalidAmountError);
    }
  });

  it("applies the same limit at other precisions", () => {
    expect(parseTokenAmount("0.000001", 6)).toBe(1n);
    expect(() => parseTokenAmount("0.0000015", 6)).toThrow(InvalidAmountError);
    expect(() => parseTokenAmount("1.5", 0)).toThrow(InvalidAmountError);
  });
});

describe("createPaymentClient decimals mismatch detection", () => {
  const input = { from: FROM, to: TO, token: xlm, amount: 5n };

  it("proceeds when on-chain decimals match the token descriptor", async () => {
    const getTokenDecimals = vi.fn().mockResolvedValue(7);
    const { client, transfer } = clientWith({ decimalsReader: { getTokenDecimals } });
    await expect(client.preparePayment(input)).resolves.toBeDefined();
    expect(getTokenDecimals).toHaveBeenCalledWith("CNATIVE");
    expect(transfer).toHaveBeenCalled();
  });

  it("throws TokenDecimalsMismatchError before building the transfer when they diverge", async () => {
    const { client, transfer } = clientWith({
      decimalsReader: { getTokenDecimals: vi.fn().mockResolvedValue(6) },
    });
    const err = await client.preparePayment(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TokenDecimalsMismatchError);
    expect((err as TokenDecimalsMismatchError).suppliedDecimals).toBe(7);
    expect((err as TokenDecimalsMismatchError).onChainDecimals).toBe(6);
    expect((err as Error).message).toMatch(/orders of magnitude/);
    expect(transfer).not.toHaveBeenCalled();
  });

  it("skips the check when the on-chain decimals cannot be read", async () => {
    const { client, transfer } = clientWith({
      decimalsReader: { getTokenDecimals: vi.fn().mockRejectedValue(new Error("rpc down")) },
    });
    await expect(client.preparePayment(input)).resolves.toBeDefined();
    expect(transfer).toHaveBeenCalled();
  });

  it("does nothing when no decimalsReader is configured", async () => {
    const { client } = clientWith();
    await expect(client.preparePayment(input)).resolves.toBeDefined();
  });
});
