// Example: generate a random ed25519 keypair suitable for use as an x402
// session key signer (vellar-sdk's createSessionKeySigner).
//
// ⚠️  TESTNET ONLY. The secret key printed here is generated fresh each run
// and has no funds — never fund it on mainnet or reuse it for a real wallet.
//
// Run with: npx tsx generate-session-key.ts

import { Keypair } from "@stellar/stellar-sdk";

export interface SessionKeyPair {
  publicKey: string;
  secretKey: string;
}

export function generateSessionKeyPair(): SessionKeyPair {
  const keypair = Keypair.random();
  return { publicKey: keypair.publicKey(), secretKey: keypair.secret() };
}

function main() {
  const { publicKey, secretKey } = generateSessionKeyPair();
  console.log("Public key:", publicKey);
  console.log("Secret key:", secretKey);
  console.log();
  console.log("⚠️  Testnet only — do not fund this key or reuse it on mainnet.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
