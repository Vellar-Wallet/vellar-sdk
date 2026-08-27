/**
 * Formats a raw stroops amount as a human readable XLM string.
 *
 * 1 XLM = 10,000,000 stroops (7 decimal places). All math is done with
 * BigInt so arbitrarily large balances don't lose precision the way they
 * would if we divided with floating point numbers.
 */

const STROOPS_PER_XLM = 10_000_000n;

export function formatStroops(stroops: bigint | number | string): string {
  const value = typeof stroops === "bigint" ? stroops : BigInt(stroops);
  const negative = value < 0n;
  const abs = negative ? -value : value;

  const whole = abs / STROOPS_PER_XLM;
  const fraction = abs % STROOPS_PER_XLM;

  const fractionDigits = fraction.toString().padStart(7, "0").replace(/0+$/, "");

  const formatted = fractionDigits.length > 0 ? `${whole}.${fractionDigits}` : whole.toString();

  return negative ? `-${formatted}` : formatted;
}

function main(): void {
  const input = process.argv[2];

  if (!input) {
    console.error("Usage: tsx format-stroops.ts <stroops>");
    process.exitCode = 1;
    return;
  }

  console.log(formatStroops(input));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
