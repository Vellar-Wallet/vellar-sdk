import type { Network } from "./types";
import type { TokenInfo } from "./balances";

// Payment domain types + amount parsing (technical-doc.md §5.2 build
// transactions). Pure module — the PasskeyKit/SAC-backed client lives in
// payments-client.ts, RPC pieces under the /rpc subpath.

export class InvalidAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAmountError";
  }
}

/**
 * Parses a user-entered decimal amount into raw token units (inverse of
 * formatTokenAmount). Rejects empty/non-numeric input, negatives, zero, and
 * more fractional digits than the token supports — never rounds silently.
 */
export type TokenAmountParseFailureReason =
  | "empty"
  | "not-a-number"
  | "negative"
  | "too-many-decimals"
  | "zero";

export type TokenAmountParseResult =
  | { ok: true; value: bigint }
  | {
      ok: false;
      reason: TokenAmountParseFailureReason;
      message: string;
    };

function invalidAmount(
  reason: TokenAmountParseFailureReason,
  message: string,
): TokenAmountParseResult {
  return { ok: false, reason, message };
}

/**
 * Parses a user-entered amount without throwing for invalid input.
 * Use the reason field to provide precise UI feedback.
 */
export function tryParseTokenAmount(
  input: string,
  decimals: number,
): TokenAmountParseResult {
  if (decimals < 0 || !Number.isInteger(decimals)) {
    throw new RangeError("decimals must be a non-negative integer, got " + decimals);
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return invalidAmount("empty", "Amount is required");
  }
  if (/^-/.test(trimmed)) {
    return invalidAmount("negative", "Amount must not be negative");
  }
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return invalidAmount("not-a-number", "Amount is not a valid number");
  }

  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    return invalidAmount(
      "too-many-decimals",
      "Amount supports at most " + decimals + " decimal places",
    );
  }

  const raw =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0");
  if (raw === 0n) {
    return invalidAmount("zero", "Amount must be greater than zero");
  }
  return { ok: true, value: raw };
}

/**
 * Parses a token amount and throws InvalidAmountError for invalid user input.
 */
export function parseTokenAmount(input: string, decimals: number): bigint {
  const result = tryParseTokenAmount(input, decimals);
  if (!result.ok) {
    throw new InvalidAmountError(result.message);
  }
  return result.value;
}
/** What the user explicitly reviews before signing (idea.md §6.1, technical-doc.md §7.4). */
export interface PaymentReview {
  from: string;
  to: string;
  token: TokenInfo;
  amount: bigint;
  network: Network;
}
