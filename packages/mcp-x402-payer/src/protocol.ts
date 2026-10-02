// The x402 v2 wire shapes this server speaks, plus the adapter to the guard
// layer's view of them.
//
// Why a local shape rather than @x402/core's exported type: the official
// `PaymentRequired` is a union over v1 and v2, and its v1 arm names the price
// `maxAmountRequired` while v2 names it `amount`. Stellar only ever uses v2.
// Pinning v2 here keeps the guards working on one concrete shape instead of
// narrowing a union at every call site, and makes an unexpected version an
// explicit, typed refusal.
//
// The v2 field set is IDENTICAL to vellar-sdk's `PaymentRequirements`, so the
// adapter below is a widening view, not a translation.

import { NoUsablePaymentOptionError, type PaymentRequired } from "vellar-sdk/x402-guards";

/** One accepted payment option (x402 v2). */
export interface X402Requirement {
  scheme: string;
  network: string;
  /** Price in the asset's base units, as a decimal string. */
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown> | null;
}

/** Server-supplied resource metadata. Every string here is UNTRUSTED. */
export interface X402ResourceInfo {
  url?: string;
  description?: string;
  mimeType?: string;
  serviceName?: string;
  tags?: string[];
  iconUrl?: string;
}

/** A decoded 402 challenge (x402 v2). */
export interface X402Challenge {
  x402Version: number;
  error?: string;
  resource?: X402ResourceInfo;
  accepts: X402Requirement[];
  extensions?: Record<string, unknown> | null;
}

/**
 * Assert a decoded challenge is x402 v2 with a usable `accepts` list.
 *
 * A v1 challenge is refused rather than coerced: its price field has a different
 * name, so silently reading `amount` off it would yield `undefined` and could
 * only fail confusingly further down.
 */
export function assertV2Challenge(decoded: unknown): X402Challenge {
  if (typeof decoded !== "object" || decoded === null) {
    throw new NoUsablePaymentOptionError("The 402 challenge did not decode to an object.");
  }
  const challenge = decoded as Partial<X402Challenge>;

  if (challenge.x402Version !== 2) {
    throw new NoUsablePaymentOptionError(
      `Unsupported x402 version ${String(challenge.x402Version)}; this server speaks x402 v2 ` +
        `(the only version the Stellar exact scheme uses).`,
    );
  }
  if (!Array.isArray(challenge.accepts) || challenge.accepts.length === 0) {
    throw new NoUsablePaymentOptionError("The 402 challenge offered no payment options.");
  }
  return challenge as X402Challenge;
}

/**
 * View a v2 challenge as the guard layer's `PaymentRequired`.
 *
 * Field-for-field identical apart from `extra`, which the official schema allows
 * to be `null` and the guards type as optional. Normalising `null → undefined`
 * is the whole of the conversion.
 */
export function toGuardView(challenge: X402Challenge): PaymentRequired {
  return {
    x402Version: challenge.x402Version,
    ...(challenge.error !== undefined ? { error: challenge.error } : {}),
    accepts: challenge.accepts.map((a) => ({
      scheme: a.scheme,
      network: a.network,
      asset: a.asset,
      amount: a.amount,
      payTo: a.payTo,
      maxTimeoutSeconds: a.maxTimeoutSeconds,
      ...(a.extra != null ? { extra: a.extra } : {}),
    })),
  };
}

/**
 * Narrow a challenge to the single option the guards cleared, preserving
 * everything else (notably `resource` and `extensions`, which the official
 * client echoes into the payload the facilitator verifies).
 */
export function narrowTo(challenge: X402Challenge, chosen: X402Requirement): X402Challenge {
  return { ...challenge, accepts: [chosen] };
}
