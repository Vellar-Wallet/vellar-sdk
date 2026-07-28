// Example: print the canonical Stellar testnet network passphrase and its
// CAIP-2 identifier. Pure constant lookup — no network calls.
//
// Run with: npx tsx testnet-network-info.ts

import { TESTNET } from "../../../src/config";

// The CAIP-2 identifier vellar-sdk's x402 client maps testnet to internally
// (src/x402-client.ts's CAIP2_BY_NETWORK / src/x402-types.ts's
// PaymentRequirements.network doc) — not exported as a named constant, so
// it's reproduced here as the same literal.
export const TESTNET_CAIP2 = "stellar:testnet";

function main() {
  console.log("Network passphrase:", TESTNET.networkPassphrase);
  console.log("CAIP-2 identifier: ", TESTNET_CAIP2);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
