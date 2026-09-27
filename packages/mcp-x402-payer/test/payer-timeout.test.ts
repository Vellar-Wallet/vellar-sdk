// Outbound request timeout tests (#417).
//
// Asserts that outbound HTTP requests (quote and pay) are bounded by
// config.requestTimeoutMs (default 25s, configurable via VELLAR_X402_REQUEST_TIMEOUT_MS).
// - An unpaid request timeout aborts cleanly without debiting the ledger.
// - A paid retry timeout catches the timeout, records spend via ledger.record,
//   and throws IndeterminateSettlementError (matching audit V-2).

import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { ConfigError, IndeterminateSettlementError } from "../src/errors.js";
import { createSpendLedger } from "../src/ledger.js";
import { createPayer, type FetchLike } from "../src/payer.js";
import {
  ASSET_A,
  b64,
  challenge,
  requirement,
  response402,
  stubSigner,
  testEnv,
} from "./helpers.js";

describe("VELLAR_X402_REQUEST_TIMEOUT_MS configuration (#417)", () => {
  it("defaults to 25_000 ms (25s)", () => {
    const config = loadConfig(testEnv());
    expect(config.requestTimeoutMs).toBe(25_000);
  });

  it("parses an explicit timeout in milliseconds", () => {
    const config = loadConfig(testEnv({ VELLAR_X402_REQUEST_TIMEOUT_MS: "5000" }));
    expect(config.requestTimeoutMs).toBe(5000);
  });

  it("rejects non-integer timeout strings", () => {
    expect(() =>
      loadConfig(testEnv({ VELLAR_X402_REQUEST_TIMEOUT_MS: "not-a-number" })),
    ).toThrow(ConfigError);
    expect(() =>
      loadConfig(testEnv({ VELLAR_X402_REQUEST_TIMEOUT_MS: "12.5" })),
    ).toThrow(ConfigError);
  });

  it("rejects non-positive timeout values", () => {
    expect(() =>
      loadConfig(testEnv({ VELLAR_X402_REQUEST_TIMEOUT_MS: "0" })),
    ).toThrow(ConfigError);
    expect(() =>
      loadConfig(testEnv({ VELLAR_X402_REQUEST_TIMEOUT_MS: "-1000" })),
    ).toThrow(ConfigError);
  });
});

describe("payer outbound timeout handling (#417)", () => {
  it("aborts cleanly without debiting the ledger when the unpaid request times out", async () => {
    const config = loadConfig(testEnv({ VELLAR_X402_REQUEST_TIMEOUT_MS: "50" }));
    const ledger = createSpendLedger(config.ceilings);
    const initialCeiling = ledger.remainingFor(ASSET_A);

    // Mock fetch that hangs forever on the initial probe
    const hangingFetch: FetchLike = async () =>
      new Promise(() => {
        // never resolves or rejects
      });

    const payer = createPayer({
      config,
      ledger,
      signer: stubSigner(),
      fetchImpl: hangingFetch,
    });

    await expect(payer.pay("https://seller.example/data", "100")).rejects.toThrow(
      /timed out/i,
    );

    // Ledger must NOT be debited
    expect(ledger.remainingFor(ASSET_A)).toBe(initialCeiling);
  });

  it("records spend and throws IndeterminateSettlementError when the paid retry times out", async () => {
    const config = loadConfig(testEnv({ VELLAR_X402_REQUEST_TIMEOUT_MS: "50" }));
    const ledger = createSpendLedger(config.ceilings);
    const initialCeiling = ledger.remainingFor(ASSET_A);
    const payAmount = 100n;

    let calls = 0;
    const scriptedFetch: FetchLike = async (_url, init) => {
      calls++;
      if (calls === 1) {
        // Initial request answers with 402 challenge
        return response402(
          challenge([requirement({ asset: ASSET_A, amount: payAmount.toString() })]),
        );
      }
      // Paid retry request (carrying PAYMENT-SIGNATURE) hangs until timeout
      return new Promise(() => {
        // never resolves
      });
    };

    const payer = createPayer({
      config,
      ledger,
      signer: stubSigner(),
      fetchImpl: scriptedFetch,
    });

    let thrownError: unknown;
    try {
      await payer.pay("https://seller.example/data", "500");
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(IndeterminateSettlementError);
    const err = thrownError as IndeterminateSettlementError;
    expect(err.asset).toBe(ASSET_A);
    expect(err.amount).toBe(payAmount);
    expect(err.reason).toMatch(/timed out after 50ms/i);

    // Ledger MUST be debited as a precaution (audit V-2)
    expect(ledger.remainingFor(ASSET_A)).toBe(initialCeiling - payAmount);
  });
});
