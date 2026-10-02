import { describe, it, expect, vi } from "vitest";
import {
  confirmMainnetPayment,
  formatMainnetWarning,
  isRealFundsNetwork,
  RealFundsConfirmationDeclinedError,
  withNetwork,
} from "./mainnet-payment-warning";

describe("mainnet-payment-warning: isRealFundsNetwork", () => {
  it("flags mainnet as real funds", () => {
    expect(isRealFundsNetwork("mainnet")).toBe(true);
  });

  it("does not flag testnet", () => {
    expect(isRealFundsNetwork("testnet")).toBe(false);
  });
});

describe("mainnet-payment-warning: formatMainnetWarning", () => {
  it("shows the network, asset, and amount before anything is signed", () => {
    const banner = formatMainnetWarning({ network: "mainnet", asset: "USDC", amount: "1.00" });
    expect(banner).toContain("MAINNET PAYMENT");
    expect(banner).toContain("REAL FUNDS");
    expect(banner).toContain("Network: mainnet");
    expect(banner).toContain("Amount:  1.00 USDC");
  });
});

describe("mainnet-payment-warning: confirmMainnetPayment", () => {
  it("is a no-op on testnet: no warning, no prompt", async () => {
    const write = vi.fn();
    const promptFn = vi.fn();

    await confirmMainnetPayment({
      network: "testnet",
      asset: "USDC",
      amount: "1.00",
      assumeYes: false,
      writeFn: write,
      promptFn,
    });

    expect(write).not.toHaveBeenCalled();
    expect(promptFn).not.toHaveBeenCalled();
  });

  it("on mainnet with --yes: prints the warning but skips the prompt", async () => {
    const write = vi.fn();
    const promptFn = vi.fn();

    await confirmMainnetPayment({
      network: "mainnet",
      asset: "USDC",
      amount: "1.00",
      assumeYes: true,
      writeFn: write,
      promptFn,
    });

    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]![0]).toContain("MAINNET PAYMENT");
    expect(promptFn).not.toHaveBeenCalled();
  });

  it("on mainnet, non-interactive, without --yes: refuses rather than hanging", async () => {
    const write = vi.fn();
    const promptFn = vi.fn();

    await expect(
      confirmMainnetPayment({
        network: "mainnet",
        asset: "USDC",
        amount: "1.00",
        assumeYes: false,
        isInteractive: false,
        writeFn: write,
        promptFn,
      }),
    ).rejects.toThrow(RealFundsConfirmationDeclinedError);

    expect(write).toHaveBeenCalledTimes(1);
    expect(promptFn).not.toHaveBeenCalled();
  });

  it("on mainnet, interactive, without --yes: proceeds when the prompt answers YES", async () => {
    const write = vi.fn();
    const promptFn = vi.fn().mockResolvedValue("YES");

    await confirmMainnetPayment({
      network: "mainnet",
      asset: "USDC",
      amount: "1.00",
      assumeYes: false,
      isInteractive: true,
      writeFn: write,
      promptFn,
    });

    expect(promptFn).toHaveBeenCalledTimes(1);
  });

  it("on mainnet, interactive, without --yes: refuses when the prompt answer is not YES", async () => {
    const write = vi.fn();
    const promptFn = vi.fn().mockResolvedValue("no");

    await expect(
      confirmMainnetPayment({
        network: "mainnet",
        asset: "USDC",
        amount: "1.00",
        assumeYes: false,
        isInteractive: true,
        writeFn: write,
        promptFn,
      }),
    ).rejects.toThrow(RealFundsConfirmationDeclinedError);
  });
});

describe("mainnet-payment-warning: withNetwork", () => {
  it("merges network onto any result without mutating the input", () => {
    const original = { paid: false, status: 200 };
    const withNet = withNetwork(original, "mainnet");

    expect(withNet).toEqual({ paid: false, status: 200, network: "mainnet" });
    expect(original).toEqual({ paid: false, status: 200 });
  });
});
