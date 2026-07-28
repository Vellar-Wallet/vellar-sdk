import { describe, expect, it } from "vitest";
import { createMockWallet, parseArgs, runSendPayment } from "./cli-send-payment";

describe("parseArgs", () => {
  it("parses all three required flags regardless of order", () => {
    const args = parseArgs(["--amount", "10.5", "--to", "GRECIPIENT", "--token", "USDC"]);
    expect(args).toEqual({ to: "GRECIPIENT", amount: "10.5", token: "USDC" });
  });

  it("throws naming every missing flag, not just the first", () => {
    expect(() => parseArgs(["--to", "GRECIPIENT"])).toThrow(/--amount.*--token|--token.*--amount/);
  });

  it("throws when a flag is missing its value", () => {
    expect(() => parseArgs(["--to", "--amount", "10"])).toThrow(/Missing value for --to/);
  });
});

describe("runSendPayment", () => {
  it("creates a wallet and submits a payment, returning a transaction hash", async () => {
    const { wallet } = createMockWallet("testnet");
    const logs: string[] = [];

    const result = await runSendPayment(
      { to: "GRECIPIENTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", amount: "12.5", token: "USDC" },
      wallet,
      (line) => logs.push(line),
    );

    expect(result.hash).toBeTruthy();
    expect(logs.some((l) => l.includes("Wallet created"))).toBe(true);
    expect(logs.some((l) => l.includes("Payment submitted"))).toBe(true);
  });

  it("rejects an unknown token before attempting to pay", async () => {
    const { wallet } = createMockWallet("testnet");
    await expect(
      runSendPayment({ to: "GRECIPIENT", amount: "1", token: "DOGE" }, wallet),
    ).rejects.toThrow(/Unknown --token/);
  });

  it("rejects an amount with too many decimal places", async () => {
    const { wallet } = createMockWallet("testnet");
    await expect(
      runSendPayment({ to: "GRECIPIENT", amount: "1.12345678", token: "USDC" }, wallet),
    ).rejects.toThrow(/at most 7 decimal places/);
  });

  it("produces a different hash for each payment submitted through the same mock wallet", async () => {
    const { wallet } = createMockWallet("testnet");
    await wallet.create();
    const first = await wallet.pay({
      to: "GRECIPIENT1",
      amount: 1_0000000n,
      token: { symbol: "USDC", contractId: "CUSDC", decimals: 7 },
    });
    const second = await wallet.pay({
      to: "GRECIPIENT2",
      amount: 2_0000000n,
      token: { symbol: "USDC", contractId: "CUSDC", decimals: 7 },
    });
    expect(first.hash).not.toBe(second.hash);
  });
});
