// Optional pre-submission x402 shape self-check (#877).
//
// Distinct from the post-hoc classifier in structural-conditions.ts: this is a
// diagnostic a caller can run on a transaction the SDK just built, before it is
// submitted, to warn that an independent observer such as the explorer would
// not classify it as x402-shaped. It never blocks submission by itself.

import {
  classifyX402Shape,
  type StructuralClassification,
  type StructuralEnvelope,
} from "./structural-conditions.js";

export interface PreflightResult {
  ok: boolean;
  classification: StructuralClassification;
  /** Present only when the envelope would fail explorer classification. */
  warning?: string;
}

export function preflightX402Shape(envelope: StructuralEnvelope): PreflightResult {
  const classification = classifyX402Shape(envelope);
  if (classification.x402Shaped) {
    return { ok: true, classification };
  }

  return {
    ok: false,
    classification,
    warning:
      `Pre-flight warning: this transaction would not be classified as x402-shaped ` +
      `by the explorer. Failed conditions: ${classification.failedConditions.join(", ")}. ` +
      `${classification.reasons.join("; ")}. This is an optional diagnostic, not proof ` +
      `that submission will fail.`,
  };
}
