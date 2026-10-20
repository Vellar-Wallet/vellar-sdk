// Issue #663 — hostile `amount` values a seller might put in a challenge.
//
// Companion to src/x402-untrusted-vectors.ts (which holds the fence vectors).
// These target the guard layer (`parseAmount` / `selectRequirements`): every one
// must be refused with InvalidRequirementsError before it reaches signing or
// budget accounting. Fold into src/x402-untrusted-vectors.ts on integration.

export interface AmountVector {
  name: string;
  amount: string;
  rationale: string;
}

export const AMOUNT_VECTORS: readonly AmountVector[] = Object.freeze([
  {
    name: "negative-amount",
    amount: "-1",
    rationale:
      "Syntactically a valid integer, semantically nonsense for a payment. A negative " +
      "would corrupt budget accounting (spend goes DOWN) and compare as cheaper than " +
      "every honest option when selecting the cheapest.",
  },
  {
    name: "large-negative-amount",
    amount: "-170141183460469231731687303715884105728",
    rationale: "-2^127: the negative edge of i128 must be refused like any other negative.",
  },
  {
    name: "negative-zero",
    amount: "-0",
    rationale: "BigInt('-0') is 0n; a sign must not be silently dropped.",
  },
  {
    name: "explicit-plus-sign",
    amount: "+5",
    rationale: "Only bare digits are a base-unit amount.",
  },
  {
    name: "negative-exponent",
    amount: "-1e5",
    rationale: "Number() accepts this; the digits-only test must not.",
  },
]);
