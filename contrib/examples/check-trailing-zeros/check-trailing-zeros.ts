// Example: Check whether a decimal amount string contains unnecessary trailing zeros after the decimal point.
//
// Run with: npx tsx contrib/examples/check-trailing-zeros/check-trailing-zeros.ts

/**
 * Determines whether a decimal amount string has unnecessary trailing zeros after the decimal point.
 *
 * Rules:
 * - Integer strings without a decimal point (e.g., "100", "0") return false (no throwing).
 * - Decimal strings ending in zero after the decimal point (e.g., "10.50", "1.000", "10.0") return true.
 * - Normalized decimal strings without trailing zeros (e.g., "10.5", "0.05") return false.
 */
export function hasTrailingZeros(amount: string): boolean {
  if (typeof amount !== 'string' || !amount.trim()) {
    return false;
  }

  const str = amount.trim();
  const decimalIndex = str.indexOf('.');

  // If there is no decimal point, it's an integer amount with no fractional trailing zeros
  if (decimalIndex === -1) {
    return false;
  }

  const fractionalPart = str.slice(decimalIndex + 1);

  // Return true if the fractional part has at least one character and ends with '0'
  return fractionalPart.length > 0 && fractionalPart.endsWith('0');
}

function main() {
  console.log('=== Check Trailing Zeros Example ===\n');

  const testCases = [
    { amount: '10.50', expected: true, note: 'Trailing zero after decimal' },
    { amount: '1.000', expected: true, note: 'Multiple trailing zeros' },
    { amount: '10.0', expected: true, note: 'Single trailing zero' },
    { amount: '0.050', expected: true, note: 'Trailing zero after non-zero fraction' },
    { amount: '10.5', expected: false, note: 'Clean normalized decimal' },
    { amount: '0.05', expected: false, note: 'Clean fraction' },
    { amount: '100', expected: false, note: 'Integer without decimal point' },
    { amount: '0', expected: false, note: 'Zero integer' },
    { amount: '1000', expected: false, note: 'Integer with trailing zeros in whole number' },
  ];

  console.log('Amount String | Has Trailing Zeros? | Notes');
  console.log('--------------|---------------------|-----------------------------------');

  for (const tc of testCases) {
    const result = hasTrailingZeros(tc.amount);
    console.log(
      `${tc.amount.padEnd(13)} | ${result ? 'TRUE ' : 'FALSE'}              | ${tc.note}`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
