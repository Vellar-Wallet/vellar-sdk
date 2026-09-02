/**
 * Formats a spending limit and a window (in seconds) as a human readable
 * sentence, e.g. "100 XLM per day". Falls back to printing the raw seconds
 * for window lengths that don't have a friendly label.
 */

const WINDOW_LABELS: Record<number, string> = {
  60: "minute",
  3600: "hour",
  86400: "day",
  604800: "week",
};

export interface FormatPolicySummaryOptions {
  unit?: string;
}

export function formatPolicySummary(
  limit: bigint | number | string,
  windowSeconds: number,
  options: FormatPolicySummaryOptions = {},
): string {
  const unit = options.unit ?? "XLM";
  const label = WINDOW_LABELS[windowSeconds];

  if (label) {
    return `${limit} ${unit} per ${label}`;
  }

  return `${limit} ${unit} per ${windowSeconds} seconds`;
}

function main(): void {
  const [limit, windowSeconds] = process.argv.slice(2);

  if (!limit || !windowSeconds) {
    console.error("Usage: tsx format-policy-summary.ts <limit> <windowSeconds>");
    process.exitCode = 1;
    return;
  }

  console.log(formatPolicySummary(limit, Number(windowSeconds)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
