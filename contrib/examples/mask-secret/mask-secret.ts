// Example: Mask secret keys for safe logging without exposing full unmasked secrets.
//
// Run with: npx tsx contrib/examples/mask-secret/mask-secret.ts

/**
 * Masks a secret key string, showing only the first `visibleChars` characters
 * followed by `*` mask characters.
 *
 * Safe Logging Guarantee:
 * - If the input is empty or invalid, returns an empty string or fixed mask.
 * - If the secret is shorter than or equal to `visibleChars`, masks all characters.
 * - Never returns or leaks the unmasked secret.
 */
export function maskSecret(
  secret: string,
  visibleChars = 4,
  maskChar = '*',
): string {
  if (!secret || typeof secret !== 'string') {
    return '';
  }

  const str = secret.trim();
  if (str.length <= visibleChars) {
    return maskChar.repeat(str.length);
  }

  const visiblePart = str.slice(0, visibleChars);
  const maskedPart = maskChar.repeat(str.length - visibleChars);
  return `${visiblePart}${maskedPart}`;
}

function main() {
  console.log('=== Mask Secret Key Example ===\n');

  // Example secret keys (Sample/Testnet values)
  // IMPORTANT: The script only prints the result of maskSecret(), never unmasked secrets!
  const sampleSecretKeys = [
    'SD4V5Q7Z3X8K9L0M1N2O3P4Q5R6S7T8U9V0W1X2Y3Z4A5B6C7D8E9F0G',
    'SBXZ9876543210FEDCBA9876543210FEDCBA9876543210FEDCBA9876',
    'S123',
    'SECRET_API_KEY_LIVE_99887766554433221100',
  ];

  console.log('Safe Masked Outputs for Logging:');
  console.log('-----------------------------------');
  for (const secretKey of sampleSecretKeys) {
    const masked = maskSecret(secretKey);
    console.log(`Masked Output : ${masked}  (Length: ${masked.length})`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
