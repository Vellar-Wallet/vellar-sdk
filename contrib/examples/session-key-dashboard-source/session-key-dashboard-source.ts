// Example: a data source function listing several mock session keys with
// their expiry status, suitable for feeding a dashboard UI.
//
// Run with: npx tsx session-key-dashboard-source.ts

export type ExpiryStatus = "active" | "expiring_soon" | "expired";

export interface SessionKeyRecord {
  keyId: string;
  address: string;
  expiresAt: string;
}

export interface SessionKeyDashboardEntry extends SessionKeyRecord {
  status: ExpiryStatus;
}

// A key within this window of expiry (but not yet expired) is "expiring
// soon" — enough lead time for a dashboard to flag it before it lapses.
const EXPIRING_SOON_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

function statusFor(expiresAt: string, now: Date): ExpiryStatus {
  const msUntilExpiry = new Date(expiresAt).getTime() - now.getTime();
  if (msUntilExpiry <= 0) return "expired";
  if (msUntilExpiry <= EXPIRING_SOON_WINDOW_MS) return "expiring_soon";
  return "active";
}

/** Builds dashboard-ready entries from raw session key records, given a
 * simulated "now" (defaults to the real current time). */
export function buildSessionKeyDashboard(
  keys: SessionKeyRecord[],
  now: Date = new Date(),
): SessionKeyDashboardEntry[] {
  return keys.map((key) => ({ ...key, status: statusFor(key.expiresAt, now) }));
}

function main() {
  // A fixed "now" so the example's output is reproducible.
  const now = new Date("2026-06-15T12:00:00.000Z");

  const sampleKeys: SessionKeyRecord[] = [
    { keyId: "sk_active", address: "CACTIVE", expiresAt: "2026-07-01T00:00:00.000Z" }, // ~16 days out
    { keyId: "sk_expiring_soon", address: "CEXPIRINGSOON", expiresAt: "2026-06-15T20:00:00.000Z" }, // 8h out
    { keyId: "sk_expired", address: "CEXPIRED", expiresAt: "2026-06-01T00:00:00.000Z" }, // in the past
  ];

  const dashboard = buildSessionKeyDashboard(sampleKeys, now);
  for (const entry of dashboard) {
    console.log(`${entry.keyId} (${entry.address}): ${entry.status} — expires ${entry.expiresAt}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
