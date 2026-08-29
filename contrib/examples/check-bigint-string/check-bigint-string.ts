// Example: Check whether a given string can be safely parsed as a non-negative bigint.
//
// Run with: npx tsx contrib/examples/check-bigint-string/check-bigint-string.ts

/**
 * Checks whether a given string is a valid non-negative bigint string.
 *
 * Rules:
 * - Must contain only digits (0-9).
 * - Rejects decimal points (e.g. "10.5").
 * - Rejects leading plus sign (e.g. "+100").
 * - Rejects negative sign (e.g. "-50").
 * - Rejects empty strings, whitespace, or non-numeric characters.
 */
export function isValidBigIntString(val: string): boolean {
  if (typeof val !== 'string' || val.length === 0) {
    return false;
  }
  // Must consist entirely of 1 or more digits (0-9)
  return /^\d+$/.test(val);
}

function main() {
  console.log('=== Check Valid BigInt String Example ===\n');

  const testCases = [
    { input: '0', description: 'Zero (Valid)' },
    { input: '123456789', description: 'Positive integer (Valid)' },
    { input: '100000000000000000000', description: 'Large bigint string (Valid)' },
    { input: '+100', description: 'Leading plus sign (Invalid)' },
    { input: '-50', description: 'Negative sign (Invalid)' },
    { input: '10.5', description: 'Decimal point (Invalid)' },
    { input: '100n', description: 'BigInt literal suffix (Invalid)' },
    { input: ' 123 ', description: 'Whitespace padding (Invalid)' },
    { input: 'abc', description: 'Alphabetic string (Invalid)' },
    { input: '', description: 'Empty string (Invalid)' },
  ];

  console.log('Input String               -> Valid Non-Negative BigInt?  (Notes)');
  console.log('-------------------------------------------------------------------------');

  for (const tc of testCases) {
    const isValid = isValidBigIntString(tc.input);
    console.log(
      `"${tc.input}".padEnd(25) -> ${isValid ? 'TRUE ' : 'FALSE'}                          (${tc.description})`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
