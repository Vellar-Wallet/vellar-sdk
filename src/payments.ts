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
export function parseTokenAmount(input: string, decimals: number): bigint {
  if (decimals < 0 || !Number.isInteger(decimals)) {
    throw new RangeError(`decimals must be a non-negative integer, got ${decimals}`);
  }
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new InvalidAmountError(`"${input}" is not a valid amount`);
  }
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new InvalidAmountError(`Amount supports at most ${decimals} decimal places`);
  }
  const raw =
    BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (raw === 0n) throw new InvalidAmountError("Amount must be greater than zero");
  return raw;
}

/** What the user explicitly reviews before signing (idea.md §6.1, technical-doc.md §7.4). */
export interface PaymentReview {
  from: string;
  to: string;
  token: TokenInfo;
  amount: bigint;
  network: Network;
}
