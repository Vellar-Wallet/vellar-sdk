// Example: Compute a given percentage of a base unit token amount using bigint arithmetic.
//
// Run with: npx tsx contrib/examples/percentage-of-amount/percentage-of-amount.ts

/**
 * Computes a given percentage of a base unit token amount, returning a bigint result.
 * Uses basis points (1% = 100 bps) to maintain precision without floating point inaccuracies.
 *
 * Edge cases:
 * - 0% returns 0n.
 * - 100% returns BigInt(amount).
 *
 * @param amount - Base unit token amount (e.g. stroops, wei, satoshis).
 * @param percentage - Percentage value from 0 to 100 (e.g. 5, 2.5, 0, 100).
 */
export function percentageOf(
  amount: bigint | string | number,
  percentage: number,
): bigint {
  const baseAmount = BigInt(amount);

  if (percentage <= 0) {
    return 0n;
  }
  if (percentage >= 100) {
    return baseAmount;
  }

  // Convert percentage to basis points (e.g. 2.5% -> 250 bps, 5% -> 500 bps)
  const basisPoints = BigInt(Math.round(percentage * 100));
  return (baseAmount * basisPoints) / 10000n;
}

function main() {
  console.log('=== Percentage of Amount Example ===\n');

  const testCases = [
    { amount: '10000000', percentage: 0, note: '0% Edge case (Returns 0)' },
    { amount: '10000000', percentage: 100, note: '100% Edge case (Returns full amount)' },
    { amount: '10000000', percentage: 5, note: '5% of 10,000,000 stroops (10 XLM)' },
    { amount: '10000000', percentage: 2.5, note: '2.5% fee calculation' },
    { amount: '500000000', percentage: 0.5, note: '0.5% protocol fee' },
    { amount: '100', percentage: 50, note: '50% of 100' },
  ];

  console.log('Base Amount (Stroops) | Percentage | Result (BigInt Stroops) | Notes');
  console.log('----------------------|------------|-------------------------|-----------------------------');

  for (const tc of testCases) {
    const result = percentageOf(tc.amount, tc.percentage);
    console.log(
      `${tc.amount.padEnd(21)} | ${(tc.percentage + '%').padEnd(10)} | ${result.toString().padEnd(23)} | ${tc.note}`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
