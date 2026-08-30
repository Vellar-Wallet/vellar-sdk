// Example: check whether a given string looks like a valid Stellar contract
// id — starts with "C", the expected length, and passes StrKey's checksum
// validation.
//
// Run with: npx tsx check-contract-id.ts <contractId>

import { StrKey } from "@stellar/stellar-sdk";

export interface ContractIdCheck {
  valid: boolean;
  reason?: string;
}

export function checkContractId(contractId: string): ContractIdCheck {
  if (!contractId.startsWith("C")) {
    return { valid: false, reason: `must start with "C", got "${contractId[0] ?? ""}"` };
  }
  if (contractId.length !== 56) {
    return { valid: false, reason: `must be 56 characters, got ${contractId.length}` };
  }
  if (!StrKey.isValidContract(contractId)) {
    return { valid: false, reason: "failed strkey checksum/encoding validation" };
  }
  return { valid: true };
}

function main() {
  const contractId = process.argv[2];
  if (!contractId) {
    console.error("Usage: npx tsx check-contract-id.ts <contractId>");
    process.exitCode = 1;
    return;
  }

  const result = checkContractId(contractId);
  if (result.valid) {
    console.log(`VALID: ${contractId}`);
  } else {
    console.log(`INVALID: ${contractId} (${result.reason})`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
