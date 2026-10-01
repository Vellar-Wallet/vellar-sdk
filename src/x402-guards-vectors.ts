// Conformance vectors for the x402 guard layer.
//
// Following the untrusted-vectors precedent: these exist so a second
// implementation of the guard decisions (e.g. a payer in another repository)
// can verify itself against the same data rather than drifting. Two payers use
// these guards today — the smart-account client and the keypair-based MCP
// payer — and a third party building its own payer needs the same contract.
//
// Each vector is a DECISION: an input challenge plus options, and the expected
// outcome, whether a chosen option or a named error class. The vectors are
// behavioural rather than golden strings, so a conforming implementation is
// free to differ in internal structure as long as the outcome matches.

import type { PaymentRequired, PaymentRequirements, X402PayOptions } from "./x402-types";
import {
  DisallowedAssetError,
  InvalidRequirementsError,
  MaxAmountExceededError,
  NoUsablePaymentOptionError,
} from "./x402-types";

// ── types ─────────────────────────────────────────────────────────────────────

/** A vector that expects `selectRequirements` to return a specific option. */
export interface GuardSelectVector {
  name: string;
  /** The decoded 402 challenge. */
  decoded: PaymentRequired;
  /** The caller's pay options (maxAmount, allowedAssets). */
  opts: X402PayOptions;
  /** The CAIP-2 network the client is on. */
  ourCaip2: string;
  /** The index into `decoded.accepts` that must be selected. */
  expectedIndex: number;
  /** Why this vector exists. */
  rationale: string;
}

/** A vector that expects `selectRequirements` to throw a specific error. */
export interface GuardErrorVector {
  name: string;
  decoded: PaymentRequired;
  opts: X402PayOptions;
  ourCaip2: string;
  /** The error class that must be thrown. */
  expectedError: typeof DisallowedAssetError | typeof InvalidRequirementsError | typeof MaxAmountExceededError | typeof NoUsablePaymentOptionError;
  /** A substring the error message must contain (optional). */
  messageContains?: string;
  rationale: string;
}

/** A vector for `parseAmount` edge cases. */
export interface AmountParseVector {
  name: string;
  /** The raw amount string from the requirement. */
  input: string;
  /** The expected BigInt value, or an error class. */
  expected: bigint | typeof InvalidRequirementsError;
  rationale: string;
}

export type GuardVector = GuardSelectVector | GuardErrorVector;

// ── shared fixtures ───────────────────────────────────────────────────────────

const CAIP2_TESTNET = "stellar:testnet";
const TOKEN = "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND";
const PAYTO = "GAN5MFH3GGAWH2UTO5DDOMDRQK6E32CE2GPAMPQT6KEHEPNHVBKJEF6A";
const ALLOWED = "CALLOWEDASSET34567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567X";
const OTHER = "COTHERASSET234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567X";

function req(over: Partial<PaymentRequirements> = {}): PaymentRequirements {
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

function dec(accepts: PaymentRequirements[]): PaymentRequired {
  return { x402Version: 2, accepts };
}

// ── selectRequirements vectors ───────────────────────────────────────────────

/**
 * Properties every conforming implementation must satisfy for EVERY vector:
 *
 *  1. A select vector must resolve to the option at `expectedIndex`.
 *  2. An error vector must throw the specified error class.
 *  3. If `messageContains` is set, the error message must include that substring.
 */
export const GUARD_SELECT_VECTORS: readonly GuardSelectVector[] = Object.freeze([
  {
    name: "disallowed-asset-does-not-shadow-later-allowed",
    decoded: dec([
      req({ asset: TOKEN, amount: "1000000" }),
      req({ asset: ALLOWED, amount: "2000000" }),
    ]),
    opts: { maxAmount: 10_000_000n, allowedAssets: [ALLOWED] },
    ourCaip2: CAIP2_TESTNET,
    expectedIndex: 1,
    rationale:
      "A disallowed asset offered first must not prevent a later allowed asset from being " +
      "selected. The filter must run before selection, not as a post-check.",
  },
  {
    name: "cheapest-option-wins",
    decoded: dec([
      req({ asset: TOKEN, amount: "5000000" }),
      req({ asset: TOKEN, amount: "1000000" }),
    ]),
    opts: { maxAmount: 10_000_000n },
    ourCaip2: CAIP2_TESTNET,
    expectedIndex: 1,
    rationale:
      "When several options are offered for the same asset, the cheapest must be selected " +
      "to avoid overpaying.",
  },
  {
    name: "exact-equality-with-maxamount-passes",
    decoded: dec([req({ amount: "1000000" })]),
    opts: { maxAmount: 1_000_000n },
    ourCaip2: CAIP2_TESTNET,
    expectedIndex: 0,
    rationale:
      "An amount exactly equal to maxAmount must be accepted — the check is `>`, not `>=`.",
  },
  {
    name: "unsponsored-skipped-for-sponsored",
    decoded: dec([
      req({ asset: TOKEN, extra: { areFeesSponsored: false } }),
      req({ asset: ALLOWED, extra: { areFeesSponsored: true } }),
    ]),
    opts: { maxAmount: 10_000_000n },
    ourCaip2: CAIP2_TESTNET,
    expectedIndex: 1,
    rationale:
      "An unsponsored option must be skipped in favour of a sponsored one. Fee sponsorship " +
      "is required for the exact flow.",
  },
  {
    name: "second-asset-selected-when-first-lacks-sponsorship",
    decoded: dec([
      req({ asset: TOKEN, extra: undefined }),
      req({ asset: ALLOWED, extra: { areFeesSponsored: true } }),
    ]),
    opts: { maxAmount: 10_000_000n },
    ourCaip2: CAIP2_TESTNET,
    expectedIndex: 1,
    rationale:
      "An option missing `extra` entirely must be skipped (not crash) and the next " +
      "sponsored option selected.",
  },
]);

export const GUARD_ERROR_VECTORS: readonly GuardErrorVector[] = Object.freeze([
  {
    name: "disallowed-asset-only-offered",
    decoded: dec([req({ asset: TOKEN }), req({ asset: OTHER })]),
    opts: { maxAmount: 10_000_000n, allowedAssets: [ALLOWED] },
    ourCaip2: CAIP2_TESTNET,
    expectedError: DisallowedAssetError,
    rationale:
      "When every offered asset is disallowed by allowedAssets, a DisallowedAssetError must " +
      "be thrown — not a generic NoUsablePaymentOptionError.",
  },
  {
    name: "no-option-on-our-network",
    decoded: dec([req({ network: "eip155:1" })]),
    opts: { maxAmount: 10_000_000n },
    ourCaip2: CAIP2_TESTNET,
    expectedError: NoUsablePaymentOptionError,
    rationale: "An option on a different network must be refused.",
  },
  {
    name: "wrong-scheme",
    decoded: dec([req({ scheme: "upto" })]),
    opts: { maxAmount: 10_000_000n },
    ourCaip2: CAIP2_TESTNET,
    expectedError: NoUsablePaymentOptionError,
    rationale: "Only the `exact` scheme is supported; others must be refused.",
  },
  {
    name: "empty-accepts-list",
    decoded: dec([]),
    opts: { maxAmount: 10n },
    ourCaip2: CAIP2_TESTNET,
    expectedError: NoUsablePaymentOptionError,
    rationale: "An empty accepts list must throw, not return undefined.",
  },
  {
    name: "fees-explicitly-not-sponsored",
    decoded: dec([req({ extra: { areFeesSponsored: false } })]),
    opts: { maxAmount: 10_000_000n },
    ourCaip2: CAIP2_TESTNET,
    expectedError: NoUsablePaymentOptionError,
    messageContains: "do not sponsor fees",
    rationale:
      "An option declaring areFeesSponsored=false must be refused with a message indicating " +
      "the reason.",
  },
  {
    name: "fees-not-declared",
    decoded: dec([req({ extra: undefined })]),
    opts: { maxAmount: 10_000_000n },
    ourCaip2: CAIP2_TESTNET,
    expectedError: NoUsablePaymentOptionError,
    messageContains: "did not declare areFeesSponsored=true",
    rationale:
      "An option with no `extra` at all must be refused with a message about missing " +
      "declaration, rather than crashing downstream with a TypeError.",
  },
  {
    name: "fees-truthy-but-not-true",
    decoded: dec([req({ extra: { areFeesSponsored: "yes" } })]),
    opts: { maxAmount: 10_000_000n },
    ourCaip2: CAIP2_TESTNET,
    expectedError: NoUsablePaymentOptionError,
    rationale:
      "A truthy-but-not-boolean-true areFeesSponsored must be refused. The check is `=== " +
      "true`, not truthy.",
  },
  {
    name: "maxamount-exceeded",
    decoded: dec([req({ amount: "9999999" })]),
    opts: { maxAmount: 1n },
    ourCaip2: CAIP2_TESTNET,
    expectedError: MaxAmountExceededError,
    rationale:
      "When the selected option's amount exceeds maxAmount, a MaxAmountExceededError must " +
      "be thrown.",
  },
  {
    name: "malformed-amount-propagates",
    decoded: dec([req({ amount: "1.5" })]),
    opts: { maxAmount: 10_000_000n },
    ourCaip2: CAIP2_TESTNET,
    expectedError: InvalidRequirementsError,
    rationale:
      "A malformed amount (non-integer) must propagate as an InvalidRequirementsError, not " +
      "cause a raw BigInt parse failure.",
  },
]);

// ── parseAmount vectors ──────────────────────────────────────────────────────

export const AMOUNT_PARSE_VECTORS: readonly AmountParseVector[] = Object.freeze([
  {
    name: "digits-only-base-unit",
    input: "1000000",
    expected: 1000000n,
    rationale: "A plain digits-only string must parse to its BigInt equivalent.",
  },
  {
    name: "beyond-safe-integer",
    input: "9007199254740993",
    expected: 9007199254740993n,
    rationale:
      "Amounts above 2^53 must retain full precision. The official client's " +
      "Number.isInteger(Number(amount)) silently rounds this.",
  },
  {
    name: "exponent-notation-rejected",
    input: "1e5",
    expected: InvalidRequirementsError,
    rationale:
      "Exponent notation must be rejected — Number() would accept it and silently change " +
      "the value.",
  },
  {
    name: "decimal-rejected",
    input: "1.5",
    expected: InvalidRequirementsError,
    rationale: "Decimal amounts must be rejected.",
  },
  {
    name: "negative-rejected",
    input: "-5",
    expected: InvalidRequirementsError,
    rationale: "Negative amounts must be rejected.",
  },
  {
    name: "empty-string-rejected",
    input: "",
    expected: InvalidRequirementsError,
    rationale: "An empty string must be rejected, not parsed as 0n.",
  },
  {
    name: "whitespace-padded-rejected",
    input: " 12 ",
    expected: InvalidRequirementsError,
    rationale: "Whitespace-padded strings must be rejected — they indicate malformed input.",
  },
  {
    name: "alpha-rejected",
    input: "abc",
    expected: InvalidRequirementsError,
    rationale: "Non-numeric strings must be rejected.",
  },
]);