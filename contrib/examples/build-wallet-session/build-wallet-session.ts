// Example: Build a minimal WalletSession object and validate its contract accountId.
//
// Run with: npx tsx contrib/examples/build-wallet-session/build-wallet-session.ts

export interface WalletSession {
  accountId: string;
  keyId?: string;
  createdAt: string;
}

/**
 * Checks whether an address string matches a Soroban contract address format
 * (starts with 'C' and is 56 characters long).
 */
export function isContractAddress(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }
  return /^C[A-Z0-9]{55}$/i.test(address.trim());
}

/**
 * Validates the accountId contract address and constructs a WalletSession object.
 * Throws an error if the accountId is not a valid contract address.
 */
export function buildWalletSession(
  accountId: string,
  keyId?: string,
): WalletSession {
  const trimmedAddress = accountId.trim();

  if (!isContractAddress(trimmedAddress)) {
    throw new Error(
      `Invalid accountId: "${accountId}" is not a valid contract address (must start with "C" and be 56 characters long).`,
    );
  }

  const session: WalletSession = {
    accountId: trimmedAddress,
    createdAt: new Date().toISOString(),
  };

  if (keyId && keyId.trim()) {
    session.keyId = keyId.trim();
  }

  return session;
}

function main() {
  console.log('=== Build WalletSession Example ===\n');

  // Example 1: Valid Contract Account ID without optional keyId
  const validContractId =
    'CA7QY3Z54G5P6H7J8K9L0M1N2O3P4Q5R6S7T8U9V0W1X2Y3Z4A5B6C7D';
  console.log('Building session for valid contract address:');
  const session1 = buildWalletSession(validContractId);
  console.log(JSON.stringify(session1, null, 2));

  console.log('\n-----------------------------------\n');

  // Example 2: Valid Contract Account ID with optional keyId
  const keyId = 'key-session-secp256r1-001';
  console.log('Building session with optional keyId:');
  const session2 = buildWalletSession(validContractId, keyId);
  console.log(JSON.stringify(session2, null, 2));

  console.log('\n-----------------------------------\n');

  // Example 3: Invalid Account ID validation
  const invalidAddress = 'GABC1234567890';
  console.log(`Attempting to build session with invalid address "${invalidAddress}":`);
  try {
    buildWalletSession(invalidAddress);
  } catch (err: any) {
    console.log(`Validation Error caught: ${err.message}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
