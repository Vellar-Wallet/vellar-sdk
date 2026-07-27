// Example: derive and print the public key for a given ed25519 secret key.
//
// ⚠️  Never pass a real mainnet secret to this (or any) example script —
// treat it as compromised the moment it touches a command line argument or
// a script you didn't write yourself. Testnet keys only.
//
// Run with: npx tsx derive-public-key.ts <secretKey>

import { Keypair } from "@stellar/stellar-sdk";

export function derivePublicKey(secretKey: string): string {
  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecret(secretKey);
  } catch {
    throw new Error(
      `"${secretKey}" is not a valid ed25519 secret key (expected a 56-char string starting with "S")`,
    );
  }
  return keypair.publicKey();
}

function main() {
  const secretKey = process.argv[2];
  if (!secretKey) {
    console.error("Usage: npx tsx derive-public-key.ts <secretKey>");
    process.exitCode = 1;
    return;
  }

  try {
    console.log("Public key:", derivePublicKey(secretKey));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
