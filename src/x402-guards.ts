// x402 guards — the PURE decision layer: decode a 402 challenge, validate it,
// and pick the one option we're willing to pay for.
//
// Deliberately free of `@stellar/stellar-sdk` and of any network access, so it
// can be reused by payers that do NOT share a signing path. Two payers use it
// today:
//   - the smart-account client in ./x402-client (V1 auth entries, C-address)
//   - the keypair-based MCP payer (packages/mcp-x402-payer), which delegates
//     build+sign to the official @x402 client
//
// Everything here is a pure function over plain data. If you need RPC, a signer,
// or an AssembledTransaction, it belongs in ./x402-client, not here.
//
// Re-exported from ./x402-client so the published API is unchanged.

import type { Network } from "./types";
import {
  DisallowedAssetError,
  InvalidRequirementsError,
  MaxAmountExceededError,
  NoUsablePaymentOptionError,
  type PaymentRequired,
  type PaymentRequirements,
  type X402PayOptions,
} from "./x402-types";

// The errors these guards throw, re-exported so a consumer importing
// "vellar-sdk/x402-guards" can catch them without also importing the wallet.
export {
  DisallowedAssetError,
  InvalidRequirementsError,
  MaxAmountExceededError,
  NoUsablePaymentOptionError,
  PaymentRejectedError,
} from "./x402-types";
export type { PaymentRequired, PaymentRequirements, X402PayOptions } from "./x402-types";

// ── base64 (browser-safe: no Buffer, no @types/node) ─────────────────────────

export function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function base64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ── network maps ─────────────────────────────────────────────────────────────

/** CAIP-2 → the network passphrase + our Network label. */
export const NETWORKS: Record<string, { passphrase: string; network: Network }> = {
  "stellar:testnet": {
    passphrase: "Test SDF Network ; September 2015",
    network: "testnet",
  },
  "stellar:pubnet": {
    passphrase: "Public Global Stellar Network ; September 2015",
    network: "mainnet",
  },
};

export const CAIP2_BY_NETWORK: Record<Network, string> = {
  testnet: "stellar:testnet",
  mainnet: "stellar:pubnet",
};

// ── amount parsing ───────────────────────────────────────────────────────────

/**
 * Parse a requirement's `amount` (decimal string, base units) as a non-negative
 * i128. Throws a typed error rather than letting `BigInt(...)` throw a raw
 * SyntaxError on malformed server input.
 *
 * Stricter than the official client's validator on purpose: that one uses
 * `Number.isInteger(Number(amount))`, which accepts `"1e5"` and silently loses
 * precision above 2^53. A digits-only test keeps the full i128 range exact.
 */
export function parseAmount(amount: string): bigint {
  if (typeof amount !== "string" || !/^\d+$/.test(amount)) {
    throw new InvalidRequirementsError(
      `x402 requirement has a non-integer amount ${JSON.stringify(amount)}.`,
    );
  }
  return BigInt(amount);
}

// ── selection ────────────────────────────────────────────────────────────────

/**
 * Pick the one payment option this client can satisfy, applying guards. Pure
 * (no network). Filters by scheme/network, then sponsored-fees, then
 * allowedAssets (WHILE selecting, so a disallowed option never shadows a later
 * allowed one), then picks the cheapest allowed option and enforces maxAmount.
 */
export function selectRequirements(
  decoded: PaymentRequired,
  opts: X402PayOptions,
  ourCaip2: string,
): PaymentRequirements {
  const options = decoded.accepts ?? [];
  const onNetwork = options.filter((a) => a.scheme === "exact" && a.network === ourCaip2);
  if (onNetwork.length === 0) {
    throw new NoUsablePaymentOptionError(
      `No exact/${ourCaip2} payment option offered. Server offered: ${options
        .map((a) => `${a.scheme}/${a.network}`)
        .join(", ") || "(none)"}`,
    );
  }

  // Fee sponsorship must be stated EXPLICITLY. Both payer paths require the
  // facilitator to rebuild and pay the fee, and the official ExactStellarScheme
  // dereferences `extra.areFeesSponsored` without a null check — an option with
  // no `extra` at all crashes there with a raw TypeError. Refusing it here turns
  // that into a typed refusal, and "unspecified" is not a safe default anyway.
  const candidates = onNetwork.filter((a) => a.extra?.areFeesSponsored === true);
  if (candidates.length === 0) {
    const declaredFalse = onNetwork.some((a) => a.extra?.areFeesSponsored === false);
    throw new NoUsablePaymentOptionError(
      declaredFalse
        ? "Payment option(s) do not sponsor fees (areFeesSponsored=false); the exact flow requires sponsored fees."
        : "Payment option(s) did not declare areFeesSponsored=true; the exact flow requires explicitly sponsored fees.",
    );
  }

  const allowed = opts.allowedAssets
    ? candidates.filter((a) => opts.allowedAssets!.includes(a.asset))
    : candidates;
  if (allowed.length === 0) {
    // Every payable candidate was disallowed by allowedAssets.
    throw new DisallowedAssetError(candidates[0]!.asset, opts.allowedAssets!);
  }

  // Prefer the cheapest allowed option (avoids overpaying when a server offers
  // the same resource in multiple assets/amounts). parseAmount validates each,
  // so a malformed amount throws a typed error rather than mis-sorting.
  const usable = allowed.reduce((cheapest, a) =>
    parseAmount(a.amount) < parseAmount(cheapest.amount) ? a : cheapest,
  );

  const required = parseAmount(usable.amount);
  if (required > opts.maxAmount) {
    throw new MaxAmountExceededError(required, opts.maxAmount, usable.asset);
  }
  return usable;
}

// ── 402 decode ───────────────────────────────────────────────────────────────

/**
 * Decode the 402's payment requirements. x402 v2 carries them in the
 * `PAYMENT-REQUIRED` header (base64 JSON); some servers also mirror them in the
 * body. Header wins.
 */
export function decodePaymentRequired(res: Response): PaymentRequired {
  const header = res.headers.get("PAYMENT-REQUIRED") ?? res.headers.get("payment-required");
  if (header) {
    try {
      return JSON.parse(base64ToUtf8(header)) as PaymentRequired;
    } catch (err) {
      throw new NoUsablePaymentOptionError(
        `Malformed PAYMENT-REQUIRED header: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  throw new NoUsablePaymentOptionError("402 response carried no PAYMENT-REQUIRED header.");
}

/** The facilitator's rejection reason, when it echoed one on a rejected retry. */
export function extractRejectionReason(res: Response): string | undefined {
  const header = res.headers.get("PAYMENT-REQUIRED") ?? res.headers.get("payment-required");
  if (!header) return undefined;
  try {
    return (JSON.parse(base64ToUtf8(header)) as { error?: string }).error;
  } catch {
    return undefined;
  }
}

/** The facilitator's settle result, as carried on the paid response. */
export interface SettleResult {
  success?: boolean;
  /** Empty string when the transaction never reached the chain. */
  transaction?: string;
  payer?: string;
  errorReason?: string;
  network?: string;
}

/**
 * Decode the facilitator's settle result VERBATIM, or `undefined` when no such
 * header is present.
 *
 * Distinguishing "absent" from "present but unsettled" is what makes the retry
 * decision safe, so this deliberately does not collapse the two — see
 * `isRetryableSettleFailure`.
 */
export function decodeSettleResponseHeader(res: Response): SettleResult | undefined {
  const header =
    res.headers.get("X-PAYMENT-RESPONSE") ??
    res.headers.get("PAYMENT-RESPONSE") ??
    res.headers.get("x-payment-response");
  if (!header) return undefined;
  try {
    return JSON.parse(base64ToUtf8(header)) as SettleResult;
  } catch {
    return undefined;
  }
}

/**
 * Was this a settle failure in which NOTHING was spent, so a freshly signed
 * retry is safe?
 *
 * Verified live against a local facilitator under RPC contention. The failing
 * response is an HTTP 402 carrying:
 *
 *   {"success":false,"errorReason":"settle_exact_stellar_transaction_submission_failed",
 *    "transaction":"","network":"stellar:testnet"}
 *
 * An EMPTY `transaction` is the signal: the facilitator releases its fee
 * reservation in exactly that case, because the payment failed before
 * submission (verify/sign/send) and zero sponsor XLM was spent. A NON-EMPTY
 * hash means it was submitted and fees were charged even though the transaction
 * then failed — retrying that burns fees again, so it is treated as terminal.
 *
 * A response with no settle header at all is a verify-stage rejection: it is
 * deterministic (an over-budget payment stays over budget) and must not retry.
 */
export function isRetryableSettleFailure(settle: SettleResult | undefined): boolean {
  if (!settle) return false;
  return settle.success === false && !settle.transaction;
}

/**
 * Decode a CONFIRMED settlement, or `undefined` if the payment did not settle.
 *
 * Deliberately returns `undefined` when `transaction` is empty: nothing was
 * spent in that case, so it must never read as a completed payment.
 */
export function decodeSettlementHeader(
  res: Response,
): { transaction: string; payer?: string } | undefined {
  const decoded = decodeSettleResponseHeader(res);
  if (!decoded?.transaction) return undefined;
  return { transaction: decoded.transaction, payer: decoded.payer };
}
