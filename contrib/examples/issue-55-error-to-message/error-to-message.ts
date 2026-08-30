/**
 * error-to-message.ts
 *
 * Maps known Vellar SDK error class instances to short, friendly display
 * strings suitable for showing directly in a UI. Falls back to a generic
 * message for any error type not explicitly handled.
 *
 * This is a self-contained example — it re-declares the SDK error classes
 * locally so the module works without installing the SDK itself. In a real
 * app you would import the error classes from "vellar-sdk" instead.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Re-declarations of the SDK error classes (names match exactly)
// In your own code replace these with:
//   import {
//     WalletNotReadyError, WalletNetworkMismatchError, InvalidAmountError,
//     InvalidRecipientError, MainnetConfigError, PolicyApiError,
//     X402NotConfiguredError, MaxAmountExceededError, DisallowedAssetError,
//     NoUsablePaymentOptionError, PaymentRejectedError, InvalidRequirementsError,
//   } from "vellar-sdk";
// ─────────────────────────────────────────────────────────────────────────────

export class WalletNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletNotReadyError";
  }
}

export class WalletNetworkMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(`Connector is configured for ${expected} but was asked to operate on ${actual}`);
    this.name = "WalletNetworkMismatchError";
  }
}

export class InvalidAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAmountError";
  }
}

export class InvalidRecipientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRecipientError";
  }
}

export class MainnetConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MainnetConfigError";
  }
}

export class PolicyApiError extends Error {
  readonly status: number;
  readonly errors?: string[];
  constructor(message: string, status: number, errors?: string[]) {
    super(message);
    this.name = "PolicyApiError";
    this.status = status;
    this.errors = errors;
  }
}

export class X402NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "X402NotConfiguredError";
  }
}

export class MaxAmountExceededError extends Error {
  readonly required: bigint;
  readonly maxAmount: bigint;
  readonly asset: string;
  constructor(required: bigint, maxAmount: bigint, asset: string) {
    super(
      `x402 payment of ${required} (${asset}) exceeds maxAmount ${maxAmount}; refusing to sign.`,
    );
    this.name = "MaxAmountExceededError";
    this.required = required;
    this.maxAmount = maxAmount;
    this.asset = asset;
  }
}

export class DisallowedAssetError extends Error {
  readonly asset: string;
  readonly allowedAssets: string[];
  constructor(asset: string, allowedAssets: string[]) {
    super(
      `x402 requested asset ${asset} is not in allowedAssets [${allowedAssets.join(", ")}].`,
    );
    this.name = "DisallowedAssetError";
    this.asset = asset;
    this.allowedAssets = allowedAssets;
  }
}

export class NoUsablePaymentOptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoUsablePaymentOptionError";
  }
}

export class PaymentRejectedError extends Error {
  readonly reason?: string;
  constructor(message: string, reason?: string) {
    super(message);
    this.name = "PaymentRejectedError";
    this.reason = reason;
  }
}

export class InvalidRequirementsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRequirementsError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Error → user-facing message mapper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert any value thrown by the Vellar SDK into a short, friendly string
 * safe to display in a UI toast, banner, or form field.
 *
 * Covers every named error class in the SDK. Unknown errors fall back to a
 * generic message so the UI never surfaces a raw stack trace or internal
 * SDK message.
 *
 * @example
 * try {
 *   await wallet.pay({ to, amount, token });
 * } catch (err) {
 *   showToast(sdkErrorToMessage(err));
 * }
 */
export function sdkErrorToMessage(err: unknown): string {
  // ── Wallet readiness ────────────────────────────────────────────────────────
  if (err instanceof WalletNotReadyError) {
    return "Please connect your wallet before continuing.";
  }

  // ── Network mismatch ────────────────────────────────────────────────────────
  if (err instanceof WalletNetworkMismatchError) {
    return "Network mismatch — check that your wallet and app are on the same Stellar network.";
  }

  // ── Payment — bad amount ────────────────────────────────────────────────────
  if (err instanceof InvalidAmountError) {
    return "Invalid amount — please enter a positive number with the correct number of decimal places.";
  }

  // ── Payment — bad recipient ─────────────────────────────────────────────────
  if (err instanceof InvalidRecipientError) {
    return "Invalid recipient address — double-check the destination before retrying.";
  }

  // ── Mainnet configuration ───────────────────────────────────────────────────
  if (err instanceof MainnetConfigError) {
    return "Mainnet configuration is incomplete. Provide a valid RPC URL and wallet WASM hash.";
  }

  // ── Policy API ──────────────────────────────────────────────────────────────
  if (err instanceof PolicyApiError) {
    if (err.status === 0) {
      return "Could not reach the policy service — check your internet connection and try again.";
    }
    if (err.status === 401 || err.status === 403) {
      return "Access denied — you are not authorised to perform this policy action.";
    }
    if (err.status === 404) {
      return "The requested policy was not found.";
    }
    if (err.status >= 500) {
      return "The policy service is temporarily unavailable. Please try again shortly.";
    }
    return "A policy error occurred. Please review your policy settings and try again.";
  }

  // ── x402 — not configured ───────────────────────────────────────────────────
  if (err instanceof X402NotConfiguredError) {
    return "Agentic payments are not set up for this wallet. Configure x402 to enable them.";
  }

  // ── x402 — amount guard ─────────────────────────────────────────────────────
  if (err instanceof MaxAmountExceededError) {
    return `Payment refused — the server is asking for more than your set limit. Increase your maximum or contact the resource provider.`;
  }

  // ── x402 — disallowed asset ─────────────────────────────────────────────────
  if (err instanceof DisallowedAssetError) {
    return "Payment refused — the server requested a token that is not on your allowed list.";
  }

  // ── x402 — no matching option ───────────────────────────────────────────────
  if (err instanceof NoUsablePaymentOptionError) {
    return "No compatible payment option was found for this resource.";
  }

  // ── x402 — facilitator rejection ───────────────────────────────────────────
  if (err instanceof PaymentRejectedError) {
    return "Payment was declined — your spending limit may have been reached, or the payment was otherwise rejected.";
  }

  // ── x402 — bad server requirements ─────────────────────────────────────────
  if (err instanceof InvalidRequirementsError) {
    return "The server sent an invalid payment request. Please try again or contact the resource provider.";
  }

  // ── Generic fallback ────────────────────────────────────────────────────────
  return "Something went wrong. Please try again or contact support if the issue persists.";
}
