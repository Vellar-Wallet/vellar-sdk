// Example: check a mock session expiry timestamp against the current time
// and report whether it's expired or active.
//
// Run with: npx tsx session-expiry-check.ts <iso-timestamp>
// Example:  npx tsx session-expiry-check.ts 2020-01-01T00:00:00.000Z

export type ExpiryResult = "expired" | "active";

export function checkExpiry(expiresAt: string, now: Date = new Date()): ExpiryResult {
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) {
    throw new RangeError(`"${expiresAt}" is not a valid ISO timestamp`);
  }
  return expiry.getTime() <= now.getTime() ? "expired" : "active";
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: npx tsx session-expiry-check.ts <iso-timestamp>");
    process.exitCode = 1;
    return;
  }

  try {
    const result = checkExpiry(arg);
    console.log(`Session expiry (${arg}): ${result.toUpperCase()}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  }
}

// Only run when executed directly (not when imported by the test file).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
