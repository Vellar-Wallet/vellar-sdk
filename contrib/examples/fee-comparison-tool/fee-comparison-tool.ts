// Example: compare estimated fees for a payment across a few sample
// priority levels and recommend the cheapest option that still confirms
// within a caller-supplied maximum wait time.
//
// Run with: npx tsx fee-comparison-tool.ts

export type FeePriority = "low" | "medium" | "high";

export interface FeeOption {
  priority: FeePriority;
  /** Estimated fee, in stroops. */
  feeStroops: bigint;
  /** Estimated confirmation time, in seconds. */
  estimatedConfirmationSeconds: number;
}

/** Hardcoded sample fee and expected confirmation time table, one entry per
 * priority level (a real integration would read this from a fee oracle). */
export const FEE_TABLE: FeeOption[] = [
  { priority: "low", feeStroops: 100n, estimatedConfirmationSeconds: 300 },
  { priority: "medium", feeStroops: 10_000n, estimatedConfirmationSeconds: 60 },
  { priority: "high", feeStroops: 1_000_000n, estimatedConfirmationSeconds: 5 },
];

export interface FeeRecommendation {
  /** null when no option in the table confirms within maxWaitSeconds. */
  recommended: FeeOption | null;
  /** Every option that meets the maxWaitSeconds deadline, in table order. */
  eligibleOptions: FeeOption[];
  reasoning: string;
}

/**
 * Recommends the lowest-fee option in `table` whose estimated confirmation
 * time is at or under `maxWaitSeconds`. Returns `recommended: null` (with a
 * reason) rather than silently picking an option that misses the deadline —
 * the whole point of a deadline constraint is that it's not optional.
 */
export function recommendFeeOption(maxWaitSeconds: number, table: FeeOption[] = FEE_TABLE): FeeRecommendation {
  const eligibleOptions = table.filter((option) => option.estimatedConfirmationSeconds <= maxWaitSeconds);

  if (eligibleOptions.length === 0) {
    return {
      recommended: null,
      eligibleOptions: [],
      reasoning: `No priority level confirms within ${maxWaitSeconds}s (fastest available is ${Math.min(...table.map((o) => o.estimatedConfirmationSeconds))}s).`,
    };
  }

  const recommended = eligibleOptions.reduce((cheapest, option) =>
    option.feeStroops < cheapest.feeStroops ? option : cheapest,
  );

  return {
    recommended,
    eligibleOptions,
    reasoning: `"${recommended.priority}" is the cheapest of ${eligibleOptions.length} option(s) confirming within ${maxWaitSeconds}s (${recommended.feeStroops} stroops, ~${recommended.estimatedConfirmationSeconds}s).`,
  };
}

function main() {
  const maxWaitSeconds = 120;
  const result = recommendFeeOption(maxWaitSeconds);

  console.log(`Comparing fee options for a deadline of ${maxWaitSeconds}s:`);
  for (const option of FEE_TABLE) {
    const meetsDeadline = option.estimatedConfirmationSeconds <= maxWaitSeconds;
    console.log(
      `  ${option.priority.padEnd(6)} ${option.feeStroops.toString().padStart(9)} stroops, ~${option.estimatedConfirmationSeconds}s` +
        (meetsDeadline ? "" : " (misses deadline)"),
    );
  }

  console.log();
  if (result.recommended) {
    console.log(`Recommendation: ${result.recommended.priority}`);
  } else {
    console.log("Recommendation: none");
  }
  console.log(`Reasoning: ${result.reasoning}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
