// Shared x402 test fixtures (used by x402-guards.test.ts and x402-client.test.ts).
// Not a published entry point — tsup only builds the entries listed in
// tsup.config.ts, so this never ships.
//
// CANONICAL FIXTURE SOURCE for facilitator-error-mapping tests.
// Any test asserting how the x402 client maps a facilitator refusal to a typed
// error MUST build its mocked 402 response via `facilitatorRefusal()` below
// rather than hand-rolling a Response. This keeps the wire shape (reason code
// placement, header encoding) consistent across suites and lets new reason
// codes be added in one place. See x402-facilitator-errors.test.ts.

import type { PaymentRequired, PaymentRequirements } from "./x402-types";

export const C_ADDRESS = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
export const TOKEN = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";
export const PAYTO = "GAN5MFH3GGAWH2UTO5DDOMDRQK6E32CE2GPAMPQT6KEHEPNHVBKJEF6A";
export const SIM_SOURCE = "GAJS3G2DMB25APEXHSR4SDHZFRZFAW5RTRWDQQ5R2L3AUJSKHQ2GKEPA";
export const CAIP2_TESTNET = "stellar:testnet";

/** Browser-safe base64 of a JSON value (mirrors the header encoding servers use). */
export function b64(o: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(o));
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

/** A payable testnet requirement; override any field. */
export function requirements(over: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: CAIP2_TESTNET,
    asset: TOKEN,
    amount: "1000000",
    payTo: PAYTO,
    maxTimeoutSeconds: 120,
    extra: { areFeesSponsored: true },
    ...over,
  };
}

/** A decoded challenge wrapping the given options. */
export function decoded(accepts: PaymentRequirements[]): PaymentRequired {
  return { x402Version: 2, accepts };
}

/** A 402 Response carrying the PAYMENT-REQUIRED header (x402 v2). */
export function response402(accepts: PaymentRequirements[]): Response {
  return new Response("{}", {
    status: 402,
    headers: { "PAYMENT-REQUIRED": b64({ x402Version: 2, error: "Payment required", accepts }) },
  });
}

/**
 * Documented facilitator spend-control refusal reason codes.
 * Extend this union (and `FACILITATOR_REFUSALS` below) when new reasons land.
 */
export type FacilitatorRefusalReason =
  | "rate_limited_payto"
  | "rate_limited_url"
  | "spend_ceiling"
  | "unbound_pool_exhausted";

/** Human-readable message paired with each documented refusal reason. */
export const FACILITATOR_REFUSALS: Record<FacilitatorRefusalReason, string> = {
  rate_limited_payto: "Too many payments to this payTo",
  rate_limited_url: "Too many payments to this resource URL",
  spend_ceiling: "Spend ceiling exceeded for this payer",
  unbound_pool_exhausted: "Unbound payment pool exhausted",
};

export interface FacilitatorRefusalOptions {
  /** Payment options advertised in the challenge (defaults to one payable requirement). */
  accepts?: PaymentRequirements[];
  /** Override the human-readable error message. */
  error?: string;
  /** Override the HTTP status (defaults to 402). */
  status?: number;
  /** Extra top-level fields merged into the PAYMENT-REQUIRED payload. */
  extra?: Record<string, unknown>;
}

/**
 * Build a mocked facilitator refusal as a 402 `Response` carrying the
 * documented reason code in the PAYMENT-REQUIRED header (x402 v2).
 *
 * The reason is surfaced both as the top-level `error` string and as a
 * `reason` field so tests can assert on whichever field the client reads.
 * Pass `overrides` to tweak the advertised options or payload.
 */
export function facilitatorRefusal(
  reason: FacilitatorRefusalReason,
  overrides: FacilitatorRefusalOptions = {},
): Response {
  const accepts = overrides.accepts ?? [requirements()];
  const error = overrides.error ?? FACILITATOR_REFUSALS[reason];
  const payload = {
    x402Version: 2,
    error,
    reason,
    accepts,
    ...overrides.extra,
  };
  return new Response("{}", {
    status: overrides.status ?? 402,
    headers: { "PAYMENT-REQUIRED": b64(payload) },
  });
}

/** The decoded PAYMENT-REQUIRED payload a `facilitatorRefusal()` response carries. */
export function facilitatorRefusalPayload(
  reason: FacilitatorRefusalReason,
  overrides: FacilitatorRefusalOptions = {},
): PaymentRequired & { error: string; reason: FacilitatorRefusalReason } {
  const accepts = overrides.accepts ?? [requirements()];
  const error = overrides.error ?? FACILITATOR_REFUSALS[reason];
  return {
    x402Version: 2,
    error,
    reason,
    accepts,
    ...overrides.extra,
  } as PaymentRequired & { error: string; reason: FacilitatorRefusalReason };
}
