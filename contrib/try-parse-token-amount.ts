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

function failure(
  reason: TokenAmountParseFailureReason,
  message: string,
): TokenAmountParseResult {
  return { ok: false, reason, message };
}

/**
 * Reference implementation for UI amount validation.
 *
 * This deliberately lives in contrib so maintainers can review the
 * non-throwing contract before promoting it into the stable SDK surface.
 */
export function tryParseTokenAmount(
  input: string,
  decimals: number,
): TokenAmountParseResult {
  if (decimals < 0 || !Number.isInteger(decimals)) {
    throw new RangeError(
      "decimals must be a non-negative integer, got " + decimals,
    );
  }

  const trimmed = input.trim();
  if (!trimmed) return failure("empty", "Amount is required");
  if (/^-/.test(trimmed)) {
    return failure("negative", "Amount must not be negative");
  }
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return failure("not-a-number", "Amount is not a valid number");
  }

  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    return failure(
      "too-many-decimals",
      "Amount supports at most " + decimals + " decimal places",
    );
  }

  const value =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0");
  if (value === 0n) {
    return failure("zero", "Amount must be greater than zero");
  }

  return { ok: true, value };
}