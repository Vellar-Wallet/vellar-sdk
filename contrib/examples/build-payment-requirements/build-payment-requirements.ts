// Example: construct a sample x402 PaymentRequirements-shaped object by
// hand and print it as JSON.
//
// Run with: npx tsx build-payment-requirements.ts

export interface PaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
}

export function buildPaymentRequirements(input: {
  network: string;
  asset: string;
  amount: string;
  payTo: string;
}): PaymentRequirements {
  if (!/^\d+$/.test(input.amount)) {
    throw new Error(`amount must be a plain digit string (base units), got "${input.amount}"`);
  }
  return { scheme: "exact", network: input.network, asset: input.asset, amount: input.amount, payTo: input.payTo };
}

function main() {
  const requirements = buildPaymentRequirements({
    network: "stellar:testnet",
    asset: "CUSDCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    amount: "2500000",
    payTo: "CPAYTOSAMPLEADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  });
  console.log(JSON.stringify(requirements, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
