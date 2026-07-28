import type { Network } from "./types";
import type { TokenInfo } from "./balances";
import { VellarError } from "./errors";

// Payment domain types + amount parsing (technical-doc.md §5.2 build
// transactions). Pure module — the PasskeyKit/SAC-backed client lives in
// payments-client.ts, RPC pieces under the /rpc subpath.

export class InvalidAmountError extends VellarError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAmountError";
  }
}

/** A recipient/destination address failed validation (send or receive side). */
export class InvalidRecipientError extends VellarError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRecipientError";
  }
}

/** A payment URI's `assetCode`/`assetIssuer` was malformed or incomplete. */
export class InvalidAssetError extends VellarError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAssetError";
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

export interface PaymentUriOptions {
  /** Decimal amount (NOT base units — this is the human-facing display value). */
  amount?: string;
  /** Non-native asset code (1-12 alphanumeric chars). Requires `assetIssuer`. */
  assetCode?: string;
  /** Issuer of `assetCode`. Requires `assetCode`. Omit both for native XLM. */
  assetIssuer?: string;
  memo?: string;
  memoType?: "MEMO_TEXT" | "MEMO_ID" | "MEMO_HASH" | "MEMO_RETURN";
}

/**
 * Builds a `web+stellar:pay` payment request URI (SEP-0007 shape) for
 * `destination`, so a payer's wallet can prefill the recipient and optionally
 * the amount/asset. Validates `amount`/`assetCode`/`assetIssuer`, throwing a
 * typed error rather than producing a broken URI.
 *
 * Note: SEP-0007's `pay` operation was written for classic (`G...`) payment
 * destinations. A Vellar account is a Soroban smart-wallet address (`C...`),
 * so this URI is SEP-7-*shaped* but not guaranteed to be accepted by a
 * generic SEP-7 wallet — it's meant for Vellar-aware payers or QR display,
 * not as a claim of full SEP-7 conformance for smart-account destinations.
 */
export function buildPaymentUri(destination: string, options: PaymentUriOptions = {}): string {
  if (!destination) {
    throw new InvalidRecipientError("Payment URI requires a destination address");
  }

  const params = new URLSearchParams({ destination });

  if (options.amount !== undefined) {
    if (!/^\d+(\.\d+)?$/.test(options.amount) || Number(options.amount) <= 0) {
      throw new InvalidAmountError(`"${options.amount}" is not a valid payment URI amount`);
    }
    params.set("amount", options.amount);
  }

  const hasCode = options.assetCode !== undefined;
  const hasIssuer = options.assetIssuer !== undefined;
  if (hasCode !== hasIssuer) {
    throw new InvalidAssetError(
      "assetCode and assetIssuer must both be provided together (omit both for native XLM)",
    );
  }
  if (hasCode) {
    if (!/^[A-Za-z0-9]{1,12}$/.test(options.assetCode!)) {
      throw new InvalidAssetError(`"${options.assetCode}" is not a valid Stellar asset code`);
    }
    params.set("asset_code", options.assetCode!);
    params.set("asset_issuer", options.assetIssuer!);
  }

  if (options.memo !== undefined) {
    params.set("memo", options.memo);
    params.set("memo_type", options.memoType ?? "MEMO_TEXT");
  }

  return `web+stellar:pay?${params.toString()}`;
}
