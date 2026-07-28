// Example: estimate the total cost of a series of planned x402 payments
// (see src/x402-types.ts for the real PaymentRequirements/X402PayOptions
// shapes this mirrors) against a mock price feed, before any of them are
// actually made — useful for an agent to budget-check a batch of planned
// requests up front.
//
// Run with: npx tsx x402-cost-estimator.ts

/** One planned payment: an asset symbol and a decimal amount in that
 * asset's own units (not base/stroop units — this is a display-level
 * estimate, not the on-chain payment itself). */
export interface PlannedPayment {
  asset: string;
  amount: string;
}

export interface ItemizedCost {
  asset: string;
  amount: string;
  referenceCost: string;
}

export interface CostEstimate {
  items: ItemizedCost[];
  totalReferenceCost: string;
  referenceCurrency: string;
}

/** Mock rate table: asset symbol -> price in USD, as a decimal string (a
 * real integration would read this from a price oracle). */
export const MOCK_RATE_TABLE: Record<string, string> = {
  USDC: "1.00",
  EURC: "1.08",
  XLM: "0.12",
};

// Fixed-point arithmetic at 6 decimal places (micro-units) so rate
// multiplication never suffers float rounding — the same reasoning as
// src/payments.ts's parseTokenAmount avoiding floats for money. This is a
// simplification for a reference example: a real integration would use each
// asset's actual on-chain decimals rather than a single shared scale.
const SCALE = 6;

function toMicroUnits(decimal: string): bigint {
  const trimmed = decimal.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`"${decimal}" is not a valid decimal amount`);
  }
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > SCALE) {
    throw new Error(`"${decimal}" has more than ${SCALE} decimal places`);
  }
  return BigInt(whole) * 10n ** BigInt(SCALE) + BigInt(fraction.padEnd(SCALE, "0") || "0");
}

function fromMicroUnits(micro: bigint): string {
  const scale = 10n ** BigInt(SCALE);
  const whole = micro / scale;
  const frac = (micro % scale).toString().padStart(SCALE, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/**
 * Estimates the total cost of `payments` in `referenceCurrency` (always
 * "USD" for this example's mock table), using `rateTable` to convert each
 * asset. Throws if any planned asset has no entry in the rate table — an
 * unpriced payment silently reported as $0 would be worse than failing
 * loudly, since the whole point is a trustworthy budget check.
 */
export function estimateCost(
  payments: PlannedPayment[],
  rateTable: Record<string, string> = MOCK_RATE_TABLE,
): CostEstimate {
  const items: ItemizedCost[] = [];
  let totalMicro = 0n;

  for (const payment of payments) {
    const rate = rateTable[payment.asset];
    if (rate === undefined) {
      throw new Error(
        `No rate available for asset "${payment.asset}". Known assets: ${Object.keys(rateTable).join(", ")}`,
      );
    }
    const referenceMicro = (toMicroUnits(payment.amount) * toMicroUnits(rate)) / 10n ** BigInt(SCALE);
    totalMicro += referenceMicro;
    items.push({ asset: payment.asset, amount: payment.amount, referenceCost: fromMicroUnits(referenceMicro) });
  }

  return { items, totalReferenceCost: fromMicroUnits(totalMicro), referenceCurrency: "USD" };
}

function main() {
  const plannedPayments: PlannedPayment[] = [
    { asset: "USDC", amount: "5" },
    { asset: "USDC", amount: "2.5" },
    { asset: "XLM", amount: "100" },
    { asset: "EURC", amount: "10" },
  ];

  const estimate = estimateCost(plannedPayments);

  console.log("Itemized cost:");
  for (const item of estimate.items) {
    console.log(`  ${item.amount} ${item.asset} -> ${item.referenceCost} ${estimate.referenceCurrency}`);
  }
  console.log(`Total estimated cost: ${estimate.totalReferenceCost} ${estimate.referenceCurrency}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
