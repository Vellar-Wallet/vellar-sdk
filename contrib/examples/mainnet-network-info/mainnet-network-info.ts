// Example: print the canonical Stellar mainnet network passphrase and its
// CAIP-2 identifier. Pure constant lookup — no network calls.
//
// Run with: npx tsx mainnet-network-info.ts

import { MAINNET } from "../../../src/config";

// The CAIP-2 identifier vellar-sdk's x402 client maps mainnet to internally
// (src/x402-client.ts's CAIP2_BY_NETWORK / src/x402-types.ts's
// PaymentRequirements.network doc) — not exported as a named constant, so
// it's reproduced here as the same literal.
export const MAINNET_CAIP2 = "stellar:pubnet";

function main() {
  console.log("Network passphrase:", MAINNET.networkPassphrase);
  console.log("CAIP-2 identifier: ", MAINNET_CAIP2);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
