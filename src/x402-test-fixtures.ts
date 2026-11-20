// Shared x402 test fixtures (used by x402-guards.test.ts and x402-client.test.ts).
// Not a published entry point — tsup only builds the entries listed in
// tsup.config.ts, so this never ships.

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
 * A plain (non-fee-bump) Vellar-shaped settlement envelope: a single
 * `invokeHostFunction` operation whose authorizer is the operation source and
 * the transaction source, with no fee-bump wrapper. This mirrors the shape the
 * SDK's payment submission path actually builds and submits.
 */
export function plainSettlementEnvelope(over: Partial<SettlementEnvelope> = {}): SettlementEnvelope {
  return {
    kind: "transaction",
    sourceAccount: SIM_SOURCE,
    fee: "100",
    operations: [
      {
        type: "invokeHostFunction",
        sourceAccount: SIM_SOURCE,
        authorizers: [SIM_SOURCE],
      },
    ],
    ...over,
  };
}

/**
 * A CAP-15 fee-bump-wrapped settlement envelope: the inner transaction carries
 * the `invokeHostFunction` operation, and the outer fee-bump transaction has its
 * own fee source. This is a *different* shape from the plain envelope above and
 * is used to exercise the structural-conditions helper against both shapes.
 */
export function feeBumpSettlementEnvelope(over: Partial<SettlementEnvelope> = {}): SettlementEnvelope {
  return {
    kind: "feeBump",
    feeSource: PAYTO,
    fee: "200",
    innerTransaction: {
      sourceAccount: SIM_SOURCE,
      fee: "100",
      operations: [
        {
          type: "invokeHostFunction",
          sourceAccount: SIM_SOURCE,
          authorizers: [SIM_SOURCE],
        },
      ],
    },
    ...over,
  };
}
