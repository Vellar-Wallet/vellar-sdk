// Example: suggest a spending limit value from a sample of an account's
// recent payment history, using a simple percentile-style calculation plus
// a headroom multiplier.
//
// This is an advisory number for a human to review before setting a real
// policy.spendingLimits value (see src/types.ts's PolicyDefinition) — not a
// payment amount itself, so plain numbers are fine here (contrast with
// src/payments.ts's parseTokenAmount, which avoids floats because it
// touches actual on-chain amounts).
//
// Run with: npx tsx policy-limit-recommender.ts

export interface RecommendationOptions {
  /** Percentile (0-100] of the sorted historical sample to use as the
   * baseline before headroom is applied. Default: 90. */
  percentile?: number;
  /** Multiplier applied to the percentile value for headroom above typical
   * spend. Default: 1.5. */
  headroomMultiplier?: number;
}

export interface LimitRecommendation {
  sampleSize: number;
  percentile: number;
  percentileValue: number;
  headroomMultiplier: number;
  recommendedLimit: number;
}

const DEFAULT_PERCENTILE = 90;
const DEFAULT_HEADROOM_MULTIPLIER = 1.5;

/** Nearest-rank percentile of a sample sorted ascending. */
function percentileOf(sortedAmounts: number[], percentile: number): number {
  const rank = Math.ceil((percentile / 100) * sortedAmounts.length);
  const index = Math.min(Math.max(rank, 1), sortedAmounts.length) - 1;
  return sortedAmounts[index]!;
}

/**
 * Recommends a spending limit from a sample of historical payment amounts:
 * takes the `percentile`-th value of the sorted sample (default 90th — "at
 * or above 90% of past payments", which drops extreme outliers like a
 * single unusually large payment), then multiplies it by
 * `headroomMultiplier` (default 1.5x) so the limit isn't a razor's edge
 * against typical activity.
 */
export function recommendSpendingLimit(
  amounts: number[],
  options: RecommendationOptions = {},
): LimitRecommendation {
  if (amounts.length === 0) {
    throw new Error("amounts must contain at least one historical payment");
  }
  for (const amount of amounts) {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`"${amount}" is not a valid non-negative payment amount`);
    }
  }

  const percentile = options.percentile ?? DEFAULT_PERCENTILE;
  if (percentile <= 0 || percentile > 100) {
    throw new Error(`percentile must be in (0, 100], got ${percentile}`);
  }
  const headroomMultiplier = options.headroomMultiplier ?? DEFAULT_HEADROOM_MULTIPLIER;

  const sorted = [...amounts].sort((a, b) => a - b);
  const percentileValue = percentileOf(sorted, percentile);
  const recommendedLimit = percentileValue * headroomMultiplier;

  return { sampleSize: amounts.length, percentile, percentileValue, headroomMultiplier, recommendedLimit };
}

function main() {
  const recentPayments = [12, 8, 45, 15, 9, 60, 11, 14, 10, 13];

  const recommendation = recommendSpendingLimit(recentPayments);

  console.log(`Sample: ${recommendation.sampleSize} payments`);
  console.log(`P${recommendation.percentile} of sample: ${recommendation.percentileValue}`);
  console.log(`Headroom multiplier: ${recommendation.headroomMultiplier}x`);
  console.log(`Recommended spending limit: ${recommendation.recommendedLimit}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
