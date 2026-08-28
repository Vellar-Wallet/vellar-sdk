// Example: format a policy record as a multi-line text summary suitable for
// printing in a terminal (e.g. a CLI listing a wallet's attached policies).
//
// Run with: npx tsx policy-summary-card.ts

export interface PolicyRecord {
  id: string;
  type: string;
  /** Human-readable spending limit, e.g. "100 XLM/day". Omitted if the
   * policy has no spending limit (e.g. a signer-limits-only policy). */
  limit?: string;
  /** Human-readable rolling window, e.g. "24h". Omitted along with `limit`
   * when there's no windowed limit to describe. */
  window?: string;
}

/** Formats a policy record as a labelled multi-line card. Missing optional
 * fields (limit, window) are omitted as whole lines, not printed blank. */
export function formatPolicySummaryCard(policy: PolicyRecord): string {
  const lines = [`Policy ID: ${policy.id}`, `Type:      ${policy.type}`];
  if (policy.limit !== undefined) {
    lines.push(`Limit:     ${policy.limit}`);
  }
  if (policy.window !== undefined) {
    lines.push(`Window:    ${policy.window}`);
  }
  return lines.join("\n");
}

function main() {
  const withLimits: PolicyRecord = {
    id: "policy_7f3a9c2e",
    type: "spending-limit",
    limit: "100 XLM/day",
    window: "24h",
  };

  const withoutLimits: PolicyRecord = {
    id: "policy_a1b2c3d4",
    type: "signer-limits",
  };

  console.log(formatPolicySummaryCard(withLimits));
  console.log();
  console.log(formatPolicySummaryCard(withoutLimits));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
