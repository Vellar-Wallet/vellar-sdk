// Conformance vectors for the x402 guard layer.
//
// These exist so a second payer implementation (in another repository or
// language) can verify its guard decisions against the same data the SDK uses.
// The untrusted-data fence established the precedent: ship vectors alongside
// the implementation so drift between two codebases is caught early.
//
// Each vector is a DECISION CASE: an input challenge + options, and the
// expected outcome — either a chosen option (by index or asset) or a named
// error class. The test harness runs every vector through the real
// selectRequirements implementation and checks the outcome.

import type { PaymentRequired, PaymentRequirements } from "./x402-types";

// ── helpers (reused by the test harness) ────────────────────────────────────

const CAIP2_TESTNET = "stellar:testnet";
const CAIP2_PUBNET = "stellar:pubnet";

/** A token address used as a stand-in for any valid SEP-41 asset. */
const TOKEN_A = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";
const TOKEN_B = "CALLOWEDASSET34567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567X";

const PAYTO = "GAN5MFH3GGAWH2UTO5DDOMDRQK6E32CE2GPAMPQT6KEHEPNHVBKJEF6A";

function req(over: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: CAIP2_TESTNET,
    asset: TOKEN_A,
    amount: "1000000",
    payTo: PAYTO,
    maxTimeoutSeconds: 120,
    extra: { areFeesSponsored: true },
    ...over,
  };
}

function challenge(accepts: PaymentRequirements[]): PaymentRequired {
  return { x402Version: 2, accepts };
}

// ── vector type ─────────────────────────────────────────────────────────────

export interface GuardVector {
  name: string;
  /** The decoded 402 challenge. */
  input: PaymentRequired;
  /** Caller options. */
  opts: { maxAmount: bigint; allowedAssets?: string[] };
  /** The CAIP-2 network the client operates on. */
  ourCaip2: string;
  /**
   * Expected outcome: either the asset of the chosen option, or the name of
   * the error class that must be thrown.
   */
  expect: { asset: string } | { error: string };
  /** Why this vector exists. */
  rationale: string;
}

// ── vectors ─────────────────────────────────────────────────────────────────

export const GUARD_VECTORS: readonly GuardVector[] = Object.freeze([
  // ── basic selection ──────────────────────────────────────────────────────
  {
    name: "single-satisfiable-option",
    input: challenge([req()]),
    opts: { maxAmount: 10_000_000n },
    ourCaip2: CAIP2_TESTNET,
    expect: { asset: TOKEN_A },
    rationale: "The simplest case: one offered option, one that satisfies all guards.",
  },
  {
    name: "picks-cheapest-when-multiple-offered",
    input: challenge([
      req({ asset: TOKEN_A, amount: "5000000" }),
      req({ asset: TOKEN_A, amount: "1000000" }),
    ]),
    opts: { maxAmount: 10_000_000n },
    ourCaip2: CAIP2_TESTNET,
    expect: { asset: TOKEN_A },
    rationale: "When several options pass all guards, the cheapest one is selected to avoid overpaying.",
  },

  // ── network / scheme filtering ───────────────────────────────────────────
  {
    name: "wrong-network-rejected",
    input: challenge([req({ network: CAIP2_PUBNET })]),
    opts: { maxAmount: 10_000_000n },
    ourCaip2: CAIP2_TESTNET,
    expect: { error: "NoUsablePaymentOptionError" },
    rationale: "An option on a different CAIP-2 network must be rejected.",
  },
  {
    name: "wrong-scheme-rejected",
    input: challenge([req({ scheme: "upto" })]),
    opts: { maxAmount: 10_000_000n },
    ourCaip2: CAIP2_TESTNET,
    expect: { error: "NoUsablePaymentOptionError" },
    rationale: "Only the 'exact' scheme is supported; any other scheme is rejected.",
  },
  {
    name: "empty-accepts-list",
    input: challenge([]),
    opts: { maxAmount: 10_000_000n },
    ourCaip2: CAIP2_TESTNET,
    expect: { error: "NoUsablePaymentOptionError" },
    rationale: "An empty accepts list has no satisfiable option.",
  },

  // ── fee sponsorship ──────────────────────────────────────────────────────
  {
    name: "unspecified-fee-sponsorship-rejected",
    input: challenge([req({ extra: undefined })]),
    opts: { maxAmount: 10_000_000n },
    ourCaip2: CAIP2_TESTNET,
    expect: { error: "NoUsablePaymentOptionError" },
    rationale: "Fee sponsorship must be declared explicitly; missing extra is rejected.",
  },
  {
    name: "explicit-false-sponsorship-rejected",
    input: challenge([req({ extra: { areFeesSponsored: false } })]),
    opts: { maxAmount: 10_000_000n },
    ourCaip2: CAIP2_TESTNET,
    expect: { error: "NoUsablePaymentOptionError" },
    rationale: "An option declaring areFeesSponsored=false is refused.",
  },
  {
    name: "truthy-not-true-sponsorship-rejected",
    input: challenge([req({ extra: { areFeesSponsored: "yes" } })]),
    opts: { maxAmount: 10_000_000n },
    ourCaip2: CAIP2_TESTNET,
    expect: { error: "NoUsablePaymentOptionError" },
    rationale: "areFeesSponsored must be boolean true, not just truthy.",
  },
  {
    name: "extra-omitting-areFeesSponsored-rejected",
    input: challenge([req({ extra: { somethingElse: 1 } })]),
    opts: { maxAmount: 10_000_000n },
    ourCaip2: CAIP2_TESTNET,
    expect: { error: "NoUsablePaymentOptionError" },
    rationale: "An extra object that doesn't mention areFeesSponsored is treated as unspecified.",
  },
  {
    name: "unsponsored-skipped-for-sponsored",
    input: challenge([
      req({ asset: TOKEN_A, extra: { areFeesSponsored: false } }),
      req({ asset: TOKEN_B, extra: { areFeesSponsored: true } }),
    ]),
    opts: { maxAmount: 10_000_000n },
    ourCaip2: CAIP2_TESTNET,
    expect: { asset: TOKEN_B },
    rationale: "An unsponsored option is skipped in favour of a sponsored one offered later.",
  },

  // ── allowedAssets ────────────────────────────────────────────────────────
  {
    name: "disallowed-asset-not-shadowing-later-allowed",
    input: challenge([
      req({ asset: TOKEN_A, amount: "1000000" }),
      req({ asset: TOKEN_B, amount: "2000000" }),
    ]),
    opts: { maxAmount: 10_000_000n, allowedAssets: [TOKEN_B] },
    ourCaip2: CAIP2_TESTNET,
    expect: { asset: TOKEN_B },
    rationale:
      "A disallowed asset offered first must not prevent a later allowed asset from being selected. " +
      "The guard filters WHILE selecting, not before.",
  },
  {
    name: "all-assets-disallowed",
    input: challenge([req({ asset: TOKEN_A }), req({ asset: TOKEN_B })]),
    opts: { maxAmount: 10_000_000n, allowedAssets: ["CNONE"] },
    ourCaip2: CAIP2_TESTNET,
    expect: { error: "DisallowedAssetError" },
    rationale: "When every offered asset is disallowed, a DisallowedAssetError is thrown.",
  },

  // ── maxAmount ────────────────────────────────────────────────────────────
  {
    name: "exact-equality-with-maxAmount-allowed",
    input: challenge([req({ amount: "1000000" })]),
    opts: { maxAmount: 1_000_000n },
    ourCaip2: CAIP2_TESTNET,
    expect: { asset: TOKEN_A },
    rationale: "An amount exactly equal to maxAmount must be accepted (not strictly less-than).",
  },
  {
    name: "amount-exceeding-maxAmount-rejected",
    input: challenge([req({ amount: "9999999" })]),
    opts: { maxAmount: 1n },
    ourCaip2: CAIP2_TESTNET,
    expect: { error: "MaxAmountExceededError" },
    rationale: "An amount exceeding maxAmount must throw MaxAmountExceededError.",
  },

  // ── amount parsing edge cases ────────────────────────────────────────────
  {
    name: "exponent-notation-rejected",
    input: challenge([req({ amount: "1e5" })]),
    opts: { maxAmount: 10_000_000n },
    ourCaip2: CAIP2_TESTNET,
    expect: { error: "InvalidRequirementsError" },
    rationale:
      "The official client accepts exponent notation via Number.isInteger(Number(amount)), " +
      "which silently loses precision. A digits-only test rejects it.",
  },
  {
    name: "precision-above-2-to-53-preserved",
    input: challenge([req({ amount: "9007199254740993" })]),
    opts: { maxAmount: 9_007_199_254_740_994n },
    ourCaip2: CAIP2_TESTNET,
    expect: { asset: TOKEN_A },
    rationale:
      "Amounts above Number.MAX_SAFE_INTEGER must parse exactly as BigInt. " +
      "The official client's Number() conversion silently rounds here.",
  },
  {
    name: "fractional-amount-rejected",
    input: challenge([req({ amount: "1.5" })]),
    opts: { maxAmount: 10_000_000n },
    ourCaip2: CAIP2_TESTNET,
    expect: { error: "InvalidRequirementsError" },
    rationale: "A fractional amount is not a valid integer string.",
  },
  {
    name: "negative-amount-rejected",
    input: challenge([req({ amount: "-5" })]),
    opts: { maxAmount: 10_000_000n },
    ourCaip2: CAIP2_TESTNET,
    expect: { error: "InvalidRequirementsError" },
    rationale: "A negative amount is not a valid base-unit string.",
  },
  {
    name: "empty-amount-rejected",
    input: challenge([req({ amount: "" })]),
    opts: { maxAmount: 10_000_000n },
    ourCaip2: CAIP2_TESTNET,
    expect: { error: "InvalidRequirementsError" },
    rationale: "An empty string is not a valid amount.",
  },
]);