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

/** Reasons a UI can use to explain why an amount cannot be submitted yet. */
export type TokenAmountParseFailureReason =
  | "empty"
  | "not-a-number"
  | "negative"
  | "too-many-decimal-places"
  | "zero"
  | "invalid-decimals";

export type TokenAmountParseResult =
  | { ok: true; value: bigint }
  | { ok: false; reason: TokenAmountParseFailureReason };

/**
 * Parses a user-entered decimal amount without throwing, which lets amount
 * inputs report a useful validation state while a user is still typing.
 */
export function tryParseTokenAmount(input: string, decimals: number): TokenAmountParseResult {
  if (decimals < 0 || !Number.isInteger(decimals)) {
    return { ok: false, reason: "invalid-decimals" };
  }

  const trimmed = input.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };
  if (trimmed.startsWith("-")) return { ok: false, reason: "negative" };
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { ok: false, reason: "not-a-number" };

  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    return { ok: false, reason: "too-many-decimal-places" };
  }

  const value =
    BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  return value === 0n ? { ok: false, reason: "zero" } : { ok: true, value };
}

/**
 * Parses a user-entered decimal amount into raw token units (inverse of
 * formatTokenAmount). Rejects empty/non-numeric input, negatives, zero, and
 * more fractional digits than the token supports — never rounds silently.
 */
export function parseTokenAmount(input: string, decimals: number): bigint {
  const result = tryParseTokenAmount(input, decimals);
  if (result.ok) return result.value;

  if (result.reason === "invalid-decimals") {
    throw new RangeError(`decimals must be a non-negative integer, got ${decimals}`);
  }
  if (result.reason === "too-many-decimal-places") {
    throw new InvalidAmountError(`Amount supports at most ${decimals} decimal places`);
  }
  if (result.reason === "zero") throw new InvalidAmountError("Amount must be greater than zero");
  throw new InvalidAmountError(`"${input}" is not a valid amount`);
}
/** What the user explicitly reviews before signing (idea.md §6.1, technical-doc.md §7.4). */
export interface PaymentReview {
  from: string;
  to: string;
  token: TokenInfo;
  amount: bigint;
  network: Network;
}
