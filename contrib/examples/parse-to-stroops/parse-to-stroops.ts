// Example: convert a human-readable XLM amount string into raw stroops as a
// bigint (1 XLM = 10,000,000 stroops, XLM's 7 decimal places).
//
// Run with: npx tsx parse-to-stroops.ts <amount>

import { parseTokenAmount } from "../../../src/payments";

const XLM_DECIMALS = 7;

/** Thin wrapper over the SDK's parseTokenAmount, fixed to XLM's 7 decimals. */
export function parseToStroops(amount: string): bigint {
  return parseTokenAmount(amount, XLM_DECIMALS);
}

function main() {
  const amount = process.argv[2];
  if (!amount) {
    console.error("Usage: npx tsx parse-to-stroops.ts <amount>");
    process.exitCode = 1;
    return;
  }

  try {
    console.log(`${amount} XLM = ${parseToStroops(amount)} stroops`);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
