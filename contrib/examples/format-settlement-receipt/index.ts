/**
 * Format an x402 settlement receipt for display.
 */

export interface FormattedReceipt {
  lines: string[];
}

export interface FormatSettlementOptions {
  /** Decimals used to convert base units to a human-readable amount. Default: 7. */
  assetDecimals?: number;
}

const REQUIRED_FIELDS: { key: keyof import("../../../src/x402-types").X402Settlement; label: string }[] = [
  { key: "transaction", label: "Transaction" },
  { key: "payer", label: "Payer" },
  { key: "asset", label: "Asset" },
  { key: "amount", label: "Amount" },
  { key: "network", label: "Network" },
];

export function formatSettlementReceipt(
  settlement: import("../../../src/x402-types").X402Settlement,
  opts?: FormatSettlementOptions,
): FormattedReceipt {
  const decimals = opts?.assetDecimals ?? 7;
  const lines: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    let value = settlement[field.key];
    if (value === undefined || value === null) continue;

    if (field.key === "amount") {
      const num = Number(value) / Math.pow(10, decimals);
      value = `${num} (base ${value.toString()})`;
    }

    lines.push(`${field.label}: ${value}`);
  }

  return { lines };
}