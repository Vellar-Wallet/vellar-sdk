// Pre-payment budget gate for x402 payments (issue #867).
//
// A CLI confirmation prompt or an MCP payer tool can call this BEFORE any
// signing happens: it combines a resource's quoted price with a conservative
// estimated fee and reports whether the total fits a caller-set budget.
//
// This is a contrib reference implementation because external PRs may only
// touch contrib/. It deliberately reads the measured fee table that actually
// exists on dev: `MEASURED_MAX_TX_FEE_STROOPS` in
// src/x402-budget-attributes.ts. The `estimateFeeBidRefusal` helper added in the
// same upstream batch imports `MEASURED_FEE_BIDS` / `MeasuredPaymentType`, names
// that the constants module does not export, so that helper cannot currently be
// imported at runtime. The arithmetic below mirrors its intent against the real
// constants; a maintainer can swap in the upstream helper once its imports are
// repaired.

import {
  MEASURED_MAX_TX_FEE_STROOPS,
  type MeasuredFeePaymentType,
} from "../../../src/x402-budget-attributes.js";

/** Payment shapes with a measured fee range. Mirrors the upstream type name
 * used by the broken helper, so callers do not need two vocabularies. */
export type BudgetPaymentType = MeasuredFeePaymentType;

/** Conservative fee estimate: the documented upper bound for the payment type. */
const ESTIMATED_FEE_STROOPS: Readonly<Record<MeasuredFeePaymentType, bigint>> =
  Object.freeze({
    "exact-classic": MEASURED_MAX_TX_FEE_STROOPS["exact-classic"].high,
    "exact-policy-governed": MEASURED_MAX_TX_FEE_STROOPS["exact-policy-governed"].high,
    "upto-smart-account": MEASURED_MAX_TX_FEE_STROOPS["upto-smart-account"].high,
  });

export interface BudgetCheck {
  /** True when `quotedPrice + estimatedFee <= maxBudget`. */
  withinBudget: boolean;
  quotedPriceStroops: bigint;
  estimatedFeeStroops: bigint;
  totalStroops: bigint;
  maxBudgetStroops: bigint;
  /** Zero when within budget, otherwise the amount over budget. */
  shortfallStroops: bigint;
  /** Human-readable explanation suitable for a CLI prompt or tool result. */
  reason: string;
}

/** Return the measured upper-bound fee for a payment type, in stroops.
 * Throws on an unknown type rather than silently estimating zero. */
export function estimatedFeeStroops(paymentType: BudgetPaymentType): bigint {
  const fee = ESTIMATED_FEE_STROOPS[paymentType];
  if (fee === undefined) {
    throw new Error(
      `unknown payment type for budget estimation: ${JSON.stringify(paymentType)} ` +
        `(expected one of ${Object.keys(ESTIMATED_FEE_STROOPS).join(", ")})`,
    );
  }
  return fee;
}

/** Check a quoted price plus its estimated fee against a caller-set budget.
 *
 * All monetary values are bigint stroops, matching the SDK's amount convention.
 * The comparison is inclusive: a total exactly equal to the budget is within
 * budget. Fee estimation is payment-type-sensitive: policy-governed payments
 * use their documented 85,999-stroop ceiling rather than the classic range.
 * No network access and no signing occurs here.
 */
export function checkBudgetAgainstQuote(
  quotedPriceStroops: bigint,
  paymentType: BudgetPaymentType,
  maxBudgetStroops: bigint,
): BudgetCheck {
  if (quotedPriceStroops < 0n) {
    throw new Error(`quoted price must be non-negative: ${quotedPriceStroops}`);
  }
  if (maxBudgetStroops < 0n) {
    throw new Error(`max budget must be non-negative: ${maxBudgetStroops}`);
  }

  const fee = estimatedFeeStroops(paymentType);
  const total = quotedPriceStroops + fee;
  const withinBudget = total <= maxBudgetStroops;
  const shortfall = withinBudget ? 0n : total - maxBudgetStroops;
  const reason = withinBudget
    ? `quote ${quotedPriceStroops} stroops plus estimated fee ${fee} stroops ` +
      `totals ${total} stroops, within the ${maxBudgetStroops} stroop budget.`
    : `quote ${quotedPriceStroops} stroops plus estimated fee ${fee} stroops ` +
      `totals ${total} stroops, exceeding the ${maxBudgetStroops} stroop budget ` +
      `by ${shortfall} stroops. Do not sign.`;

  return {
    withinBudget,
    quotedPriceStroops,
    estimatedFeeStroops: fee,
    totalStroops: total,
    maxBudgetStroops,
    shortfallStroops: shortfall,
    reason,
  };
}
