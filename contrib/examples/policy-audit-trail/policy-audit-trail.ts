// Example: format a list of sample policy change events (create, update,
// remove) as a readable chronological audit trail — oldest first. Input
// order is never assumed to already be sorted: events are sorted by
// timestamp before rendering, so passing them in any order (e.g. as fetched
// newest-first from an API) still produces a correct trail.
//
// Run with: npx tsx policy-audit-trail.ts

export type PolicyChangeAction = "create" | "update" | "remove";

export interface PolicyChangeEvent {
  action: PolicyChangeAction;
  policyId: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
}

function actionLabel(action: PolicyChangeAction): string {
  switch (action) {
    case "create":
      return "Created";
    case "update":
      return "Updated";
    case "remove":
      return "Removed";
  }
}

/**
 * Formats `events` as a readable chronological audit trail, **oldest
 * first**. Input order is never assumed to already be sorted — events are
 * sorted by `timestamp` before rendering, so a caller can pass them in any
 * order and get a correct trail regardless.
 */
export function formatAuditTrail(events: PolicyChangeEvent[]): string {
  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return sorted
    .map((event) => `[${event.timestamp}] ${actionLabel(event.action)} policy (${event.policyId})`)
    .join("\n");
}

function main() {
  // Deliberately out of chronological order, to demonstrate that
  // formatAuditTrail sorts rather than trusting input order.
  const events: PolicyChangeEvent[] = [
    { action: "remove", policyId: "spending-limit-policy", timestamp: "2026-03-03T09:15:00Z" },
    { action: "create", policyId: "spending-limit-policy", timestamp: "2026-01-10T12:00:00Z" },
    { action: "update", policyId: "signer-threshold-policy", timestamp: "2026-02-14T08:30:00Z" },
    { action: "create", policyId: "signer-threshold-policy", timestamp: "2026-01-20T16:45:00Z" },
  ];

  console.log(formatAuditTrail(events));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
