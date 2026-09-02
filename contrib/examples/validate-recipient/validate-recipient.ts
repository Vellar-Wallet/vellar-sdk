// Example: validate a Stellar address before treating it as a valid payment
// recipient — an isValidAddress-style check, as required by
// createVellarWallet's config (VellarWalletConfig.isValidAddress) and used
// internally by the payments client to reject a bad recipient before ever
// building a transaction.
//
// A Vellar wallet's recipients may be either a classic account (G...) or a
// contract (C...), so both are accepted.
//
// Run with: npx tsx validate-recipient.ts <address>

import { StrKey } from "@stellar/stellar-sdk";

export interface AddressCheck {
  valid: boolean;
  reason?: string;
}

export function validateRecipient(address: string): AddressCheck {
  if (StrKey.isValidEd25519PublicKey(address)) {
    return { valid: true };
  }
  if (StrKey.isValidContract(address)) {
    return { valid: true };
  }
  if (!address) {
    return { valid: false, reason: "address is empty" };
  }
  const prefix = address[0];
  if (prefix !== "G" && prefix !== "C") {
    return {
      valid: false,
      reason: `must start with "G" (account) or "C" (contract), got "${prefix}"`,
    };
  }
  return { valid: false, reason: "failed strkey checksum/encoding validation" };
}

function main() {
  const address = process.argv[2];
  if (!address) {
    console.error("Usage: npx tsx validate-recipient.ts <address>");
    process.exitCode = 1;
    return;
  }

  const result = validateRecipient(address);
  if (result.valid) {
    console.log(`VALID: ${address}`);
  } else {
    console.log(`INVALID: ${address} (${result.reason})`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
