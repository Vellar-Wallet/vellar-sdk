import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVellarWallet } from "../../src/client";
import { InvalidAmountError } from "../../src/payments";
import { InvalidRecipientError } from "../../src/payments-client";
import type { TokenInfo } from "../../src/balances";

// wallet.pay degenerate inputs (#652 zero amount, #653 self-payment). Both are
// rejected, with a named error, before simulation and before any passkey prompt.

beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { credentials: {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const token: TokenInfo = { contractId: "CTOKEN", symbol: "XLM", decimals: 7 };
const ACCOUNT = "CWALLET";

function build() {
  const transfer = vi.fn(async () => "built-transfer-xdr");
  const sac = { getSACClient: vi.fn(() => ({ transfer })) };
  const kit = {
    createWallet: vi.fn(),
    connectWallet: vi.fn(async () => ({
      keyIdBase64: "key",
      contractId: ACCOUNT,
    })),
    sign: vi.fn(async (tx: unknown) => tx),
    wallet: undefined,
  };
  const backend = {
    submitWalletCreation: vi.fn(),
    lookupContractId: vi.fn(async () => ({
      contractId: ACCOUNT,
      sessionId: "s",
    })),
    submitTransaction: vi.fn(async () => ({ hash: "txhash" })),
  };
  const wallet = createVellarWallet({
    network: "testnet",
    appName: "Test",
    kit: kit as never,
    backend: backend as never,
    sac: sac as never,
    isValidAddress: () => true,
  });
  return { wallet, kit, backend, sac, transfer };
}

function expectNothingBuiltSignedOrSubmitted({
  kit,
  backend,
  sac,
  transfer,
}: ReturnType<typeof build>) {
  expect(sac.getSACClient).not.toHaveBeenCalled();
  expect(transfer).not.toHaveBeenCalled();
  expect(kit.sign).not.toHaveBeenCalled();
  expect(backend.submitTransaction).not.toHaveBeenCalled();
}

describe("wallet.pay with a zero amount (#652)", () => {
  it("rejects 0n with InvalidAmountError before simulation or passkey prompt", async () => {
    const ctx = build();
    await ctx.wallet.connect();
    const pay = ctx.wallet.pay({ to: "CDEST", amount: 0n, token });
    await expect(pay).rejects.toBeInstanceOf(InvalidAmountError);
    await expect(pay).rejects.toThrow(/greater than zero/);
    expectNothingBuiltSignedOrSubmitted(ctx);
  });

  it("rejects a negative amount the same way", async () => {
    const ctx = build();
    await ctx.wallet.connect();
    await expect(ctx.wallet.pay({ to: "CDEST", amount: -1n, token })).rejects.toBeInstanceOf(
      InvalidAmountError,
    );
    expectNothingBuiltSignedOrSubmitted(ctx);
  });

  it("happy path: the smallest positive amount is built, signed, and submitted", async () => {
    const ctx = build();
    await ctx.wallet.connect();
    await expect(ctx.wallet.pay({ to: "CDEST", amount: 1n, token })).resolves.toEqual({
      hash: "txhash",
    });
    expect(ctx.transfer).toHaveBeenCalledWith(
      { from: ACCOUNT, to: "CDEST", amount: 1n },
      { timeoutInSeconds: 30 },
    );
    expect(ctx.kit.sign).toHaveBeenCalledTimes(1);
  });
});

describe("wallet.pay to the connected account (#653)", () => {
  // Decision: a self-payment is rejected, not sent. It is valid on-chain but in
  // practice an accidental input from a UI bug, and it would burn a sponsored fee.
  it("rejects with InvalidRecipientError before simulation or passkey prompt", async () => {
    const ctx = build();
    const session = await ctx.wallet.connect();
    const pay = ctx.wallet.pay({ to: session.accountId, amount: 5n, token });
    await expect(pay).rejects.toBeInstanceOf(InvalidRecipientError);
    await expect(pay).rejects.toThrow(/differ from the sending account/);
    expectNothingBuiltSignedOrSubmitted(ctx);
  });

  it("happy path: a different recipient is accepted", async () => {
    const ctx = build();
    await ctx.wallet.connect();
    await expect(ctx.wallet.pay({ to: "CDEST", amount: 5n, token })).resolves.toEqual({
      hash: "txhash",
    });
  });
});
