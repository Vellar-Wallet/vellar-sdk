// Self-contained reference for issue #227: harden session expiry handling
// for idle connectors. The real vellar-sdk session store (src/session.ts)
// doesn't currently expire an idle session on restore — this is a
// standalone, dependency-free demonstration of the check that fix would
// add, along with a debug log entry on expiration.
//
// Run with: npx tsx session-idle-timeout.ts

export interface MockSession {
  accountId: string;
  lastActiveAt: string; // ISO timestamp
}

export type IdleCheckResult =
  | { expired: false }
  | { expired: true; idleForMs: number };

/**
 * Checks whether `session` has been idle (time since `lastActiveAt`) past
 * `idleTimeoutMs`, relative to `now`.
 *
 * A `lastActiveAt` in the future (clock skew, a corrupted persisted value)
 * is never treated as expired — only a genuinely elapsed idle period is.
 * The boundary is exclusive: idle-for exactly `idleTimeoutMs` is still
 * valid (idleForMs > idleTimeoutMs, not >=), so a session isn't punished
 * for landing exactly on the threshold due to clock rounding.
 */
export function checkIdleExpiry(
  session: MockSession,
  idleTimeoutMs: number,
  now: Date = new Date(),
): IdleCheckResult {
  const idleForMs = now.getTime() - Date.parse(session.lastActiveAt);
  if (idleForMs > idleTimeoutMs) {
    return { expired: true, idleForMs };
  }
  return { expired: false };
}

/**
 * Debug log entry emitted when a session is found idle-expired. A real
 * connector would clear the session's persisted state after logging this.
 */
export function logIdleExpiration(session: MockSession, idleForMs: number): void {
  console.debug(
    `[session] idle expiry: account=${session.accountId} idleForMs=${idleForMs}`,
  );
}

function main() {
  const now = new Date("2026-07-16T10:10:00.000Z");
  const idleTimeoutMs = 5 * 60 * 1000; // 5 minutes

  const freshSession: MockSession = {
    accountId: "CFRESH",
    lastActiveAt: "2026-07-16T10:06:00.000Z", // 4 min idle
  };
  const staleSession: MockSession = {
    accountId: "CSTALE",
    lastActiveAt: "2026-07-16T10:00:00.000Z", // 10 min idle
  };

  for (const session of [freshSession, staleSession]) {
    const result = checkIdleExpiry(session, idleTimeoutMs, now);
    if (result.expired) {
      logIdleExpiration(session, result.idleForMs);
      console.log(`${session.accountId}: EXPIRED (idle ${result.idleForMs}ms)`);
    } else {
      console.log(`${session.accountId}: ACTIVE`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
