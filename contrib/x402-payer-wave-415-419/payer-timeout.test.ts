import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  executePaidRetryWithTimeout,
  fetchWithTimeout,
  IndeterminateSettlementError,
  parseRequestTimeoutMs,
} from "./payer-timeout";

describe("payer timeout (#417)", () => {
  it("defaults to 25,000ms", () => {
    expect(parseRequestTimeoutMs(undefined)).toBe(25_000);
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(25_000);
  });

  it("parses valid positive integer timeout", () => {
    expect(parseRequestTimeoutMs("10000")).toBe(10_000);
    expect(parseRequestTimeoutMs(" 30000 ")).toBe(30_000);
  });

  it("rejects non-integer or non-positive timeout", () => {
    expect(() => parseRequestTimeoutMs("invalid")).toThrow(/must be a positive integer/);
    expect(() => parseRequestTimeoutMs("0")).toThrow(/must be greater than 0/);
    expect(() => parseRequestTimeoutMs("-5")).toThrow(/must be a positive integer/);
  });

  it("unpaid request timeout throws without debiting any ledger", async () => {
    const hangingFetch = vi.fn().mockImplementation(
      (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted.");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );

    await expect(
      fetchWithTimeout("https://example.com/unpaid", {}, 50, hangingFetch),
    ).rejects.toThrow();
  });

  it("paid retry timeout debits the spend ledger and throws IndeterminateSettlementError", async () => {
    let debitedAmount = 0n;
    const ledger = {
      assertWithinCeiling: vi.fn(),
      debit: vi.fn((_asset: string, amount: bigint) => {
        debitedAmount += amount;
      }),
    };

    const hangingFetch = vi.fn().mockImplementation(
      (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted.");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );

    await expect(
      executePaidRetryWithTimeout(
        "https://example.com/paid",
        {},
        "CASSET123",
        500_000n,
        ledger,
        50,
        hangingFetch,
      ),
    ).rejects.toThrow(IndeterminateSettlementError);

    expect(ledger.debit).toHaveBeenCalledWith("CASSET123", 500_000n);
    expect(debitedAmount).toBe(500_000n);
  });
});
