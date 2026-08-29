// Example: format a list of sample signer change events (add, update,
// remove) as a readable chronological trail — oldest first, regardless of
// the order the events were given in.
//
// Run with: npx tsx signer-audit-trail.ts

export type SignerAction = "add" | "update" | "remove";

/** The kinds of signer a Vellar smart account can have (idea.md §6 lists
 * passkey + policy-contract enforcement; ed25519 covers x402 session keys —
 * see src/x402-types.ts's SmartAccountX402Signer). */
export type SignerKeyType = "ed25519" | "passkey" | "policy-contract";

export interface SignerChangeEvent {
  action: SignerAction;
  keyType: SignerKeyType;
  signerId: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
}

function actionLabel(action: SignerAction): string {
  switch (action) {
    case "add":
      return "Added";
    case "update":
      return "Updated";
    case "remove":
      return "Removed";
  }
}

/**
 * Formats `events` as a readable chronological trail, **oldest first**.
 * Input order is never assumed to already be sorted — events are sorted by
 * `timestamp` before rendering, so a caller can pass them in any order
 * (e.g. as fetched from an API in reverse-chronological order) and get a
 * correct trail regardless.
 */
export function formatAuditTrail(events: SignerChangeEvent[]): string {
  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return sorted
    .map((event) => `[${event.timestamp}] ${actionLabel(event.action)} ${event.keyType} signer (${event.signerId})`)
    .join("\n");
}

function main() {
  // Deliberately out of chronological order, to demonstrate that
  // formatAuditTrail sorts rather than trusting input order.
  const events: SignerChangeEvent[] = [
    { action: "remove", keyType: "ed25519", signerId: "session-key-1", timestamp: "2026-03-03T09:15:00Z" },
    { action: "add", keyType: "passkey", signerId: "device-alice-iphone", timestamp: "2026-01-10T12:00:00Z" },
    { action: "update", keyType: "policy-contract", signerId: "spending-limit-policy", timestamp: "2026-02-14T08:30:00Z" },
    { action: "add", keyType: "ed25519", signerId: "session-key-1", timestamp: "2026-02-01T16:45:00Z" },
  ];

  console.log(formatAuditTrail(events));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
