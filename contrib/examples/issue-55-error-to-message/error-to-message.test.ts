/**
 * error-to-message.test.ts
 *
 * Tests for sdkErrorToMessage.
 *
 * Run from the repo root:
 *   npx vitest run contrib/examples/issue-55-error-to-message/error-to-message.test.ts
 *
 * Or run the whole suite:
 *   npm test
 */

import { describe, it, expect } from "vitest";
import {
  sdkErrorToMessage,
  WalletNotReadyError,
  WalletNetworkMismatchError,
  InvalidAmountError,
  InvalidRecipientError,
  MainnetConfigError,
  PolicyApiError,
  X402NotConfiguredError,
  MaxAmountExceededError,
  DisallowedAssetError,
  NoUsablePaymentOptionError,
  PaymentRejectedError,
  InvalidRequirementsError,
} from "./error-to-message";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Assert message is non-empty and does not look like a raw internal error. */
function expectFriendly(msg: string): void {
  expect(msg.length).toBeGreaterThan(0);
  // Should not start with a capital error-class name like "WalletNotReadyError:"
  expect(msg).not.toMatch(/^[A-Z][a-zA-Z]+Error:/);
  // Should not expose internal stack hints
  expect(msg).not.toContain("at Object.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Known error classes
// ─────────────────────────────────────────────────────────────────────────────

describe("sdkErrorToMessage — known SDK errors", () => {
  it("WalletNotReadyError → prompt to connect", () => {
    const msg = sdkErrorToMessage(new WalletNotReadyError("not ready"));
    expectFriendly(msg);
    expect(msg.toLowerCase()).toContain("connect");
  });

  it("WalletNetworkMismatchError → network mismatch message", () => {
    const msg = sdkErrorToMessage(new WalletNetworkMismatchError("testnet", "mainnet"));
    expectFriendly(msg);
    expect(msg.toLowerCase()).toContain("network");
  });

  it("InvalidAmountError → amount guidance", () => {
    const msg = sdkErrorToMessage(new InvalidAmountError("0 is not valid"));
    expectFriendly(msg);
    expect(msg.toLowerCase()).toContain("amount");
  });

  it("InvalidRecipientError → recipient guidance", () => {
    const msg = sdkErrorToMessage(new InvalidRecipientError("bad address"));
    expectFriendly(msg);
    expect(msg.toLowerCase()).toContain("recipient");
  });

  it("MainnetConfigError → config guidance", () => {
    const msg = sdkErrorToMessage(
      new MainnetConfigError("mainnetConfig: rpcUrl is required"),
    );
    expectFriendly(msg);
    expect(msg.toLowerCase()).toContain("mainnet");
  });

  describe("PolicyApiError", () => {
    it("status 0 → network connectivity message", () => {
      const msg = sdkErrorToMessage(new PolicyApiError("network request failed", 0));
      expectFriendly(msg);
      expect(msg.toLowerCase()).toContain("connection");
    });

    it("status 401 → access denied message", () => {
      const msg = sdkErrorToMessage(new PolicyApiError("unauthorized", 401));
      expectFriendly(msg);
      expect(msg.toLowerCase()).toContain("access denied");
    });

    it("status 403 → access denied message", () => {
      const msg = sdkErrorToMessage(new PolicyApiError("forbidden", 403));
      expectFriendly(msg);
      expect(msg.toLowerCase()).toContain("access denied");
    });

    it("status 404 → not found message", () => {
      const msg = sdkErrorToMessage(new PolicyApiError("not found", 404));
      expectFriendly(msg);
      expect(msg.toLowerCase()).toContain("not found");
    });

    it("status 500 → service unavailable message", () => {
      const msg = sdkErrorToMessage(new PolicyApiError("internal server error", 500));
      expectFriendly(msg);
      expect(msg.toLowerCase()).toContain("unavailable");
    });

    it("other status → generic policy message", () => {
      const msg = sdkErrorToMessage(new PolicyApiError("bad request", 400));
      expectFriendly(msg);
      expect(msg.toLowerCase()).toContain("policy");
    });
  });

  it("X402NotConfiguredError → x402 setup guidance", () => {
    const msg = sdkErrorToMessage(
      new X402NotConfiguredError("wallet.x402 requires x402 config"),
    );
    expectFriendly(msg);
    expect(msg.toLowerCase()).toContain("x402");
  });

  it("MaxAmountExceededError → amount limit message", () => {
    const msg = sdkErrorToMessage(
      new MaxAmountExceededError(5_000_000n, 1_000_000n, "USDC"),
    );
    expectFriendly(msg);
    expect(msg.toLowerCase()).toContain("limit");
  });

  it("DisallowedAssetError → disallowed token message", () => {
    const msg = sdkErrorToMessage(new DisallowedAssetError("UNKNOWN", ["USDC", "XLM"]));
    expectFriendly(msg);
    expect(msg.toLowerCase()).toContain("token");
  });

  it("NoUsablePaymentOptionError → no compatible option message", () => {
    const msg = sdkErrorToMessage(
      new NoUsablePaymentOptionError("no matching scheme/asset"),
    );
    expectFriendly(msg);
    expect(msg.toLowerCase()).toContain("payment option");
  });

  it("PaymentRejectedError → payment declined message", () => {
    const msg = sdkErrorToMessage(
      new PaymentRejectedError("over budget", "DAILY_LIMIT_EXCEEDED"),
    );
    expectFriendly(msg);
    expect(msg.toLowerCase()).toContain("declined");
  });

  it("InvalidRequirementsError → bad server request message", () => {
    const msg = sdkErrorToMessage(
      new InvalidRequirementsError("amount is negative"),
    );
    expectFriendly(msg);
    expect(msg.toLowerCase()).toContain("invalid");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unknown / generic error types
// ─────────────────────────────────────────────────────────────────────────────

describe("sdkErrorToMessage — unknown / generic error types", () => {
  it("plain Error → generic fallback", () => {
    const msg = sdkErrorToMessage(new Error("some internal detail"));
    expectFriendly(msg);
    // Should not leak internal detail in the user-facing string
    expect(msg).not.toContain("some internal detail");
    expect(msg.toLowerCase()).toContain("something went wrong");
  });

  it("string throw → generic fallback", () => {
    const msg = sdkErrorToMessage("unexpected string error");
    expectFriendly(msg);
    expect(msg.toLowerCase()).toContain("something went wrong");
  });

  it("null throw → generic fallback", () => {
    const msg = sdkErrorToMessage(null);
    expectFriendly(msg);
    expect(msg.toLowerCase()).toContain("something went wrong");
  });

  it("undefined throw → generic fallback", () => {
    const msg = sdkErrorToMessage(undefined);
    expectFriendly(msg);
    expect(msg.toLowerCase()).toContain("something went wrong");
  });

  it("number throw → generic fallback", () => {
    const msg = sdkErrorToMessage(42);
    expectFriendly(msg);
    expect(msg.toLowerCase()).toContain("something went wrong");
  });

  it("custom error class not in SDK → generic fallback", () => {
    class MyAppError extends Error {}
    const msg = sdkErrorToMessage(new MyAppError("app-level detail"));
    expectFriendly(msg);
    expect(msg.toLowerCase()).toContain("something went wrong");
  });
});
