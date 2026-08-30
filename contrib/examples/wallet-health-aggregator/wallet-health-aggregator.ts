// Example: an aggregator that runs a handful of mock health checks —
// session validity, backend reachability, and RPC reachability — and
// reports an overall "healthy" or "degraded" status for a wallet.
//
// The overall status is "degraded" if ANY individual check fails; there is
// no partial-credit state.
//
// Run with: npx tsx wallet-health-aggregator.ts

export type HealthStatus = "healthy" | "degraded";

export interface HealthCheckResult {
  name: string;
  passed: boolean;
  /** Present only when passed is false. */
  reason?: string;
}

export interface HealthReport {
  status: HealthStatus;
  checks: HealthCheckResult[];
}

export interface MockSession {
  connected: boolean;
  expiresAt: string;
}

export interface HealthAggregatorDeps {
  session: MockSession | null;
  pingBackend: () => Promise<boolean>;
  pingRpc: () => Promise<boolean>;
  now?: Date;
}

function checkSessionValid(session: MockSession | null, now: Date): HealthCheckResult {
  const name = "Session valid";
  if (!session) {
    return { name, passed: false, reason: "No active session" };
  }
  if (!session.connected) {
    return { name, passed: false, reason: "Session exists but is not connected" };
  }
  if (new Date(session.expiresAt).getTime() <= now.getTime()) {
    return { name, passed: false, reason: `Session expired at ${session.expiresAt}` };
  }
  return { name, passed: true };
}

async function checkReachable(name: string, pingLabel: string, ping: () => Promise<boolean>): Promise<HealthCheckResult> {
  try {
    const ok = await ping();
    if (!ok) return { name, passed: false, reason: `${pingLabel} ping returned false` };
    return { name, passed: true };
  } catch (err) {
    return { name, passed: false, reason: `${pingLabel} ping threw: ${(err as Error).message}` };
  }
}

/**
 * Runs three mock health checks — session validity, backend reachability,
 * RPC reachability — and reports the account "degraded" if any of them
 * failed, "healthy" only if all of them passed.
 */
export async function runHealthAggregator(deps: HealthAggregatorDeps): Promise<HealthReport> {
  const now = deps.now ?? new Date();
  const checks = [
    checkSessionValid(deps.session, now),
    await checkReachable("Backend reachable", "Backend", deps.pingBackend),
    await checkReachable("RPC reachable", "RPC", deps.pingRpc),
  ];
  return { status: checks.every((c) => c.passed) ? "healthy" : "degraded", checks };
}

/** Renders a HealthReport as readable text. */
export function formatReport(report: HealthReport): string {
  const lines: string[] = [`Overall status: ${report.status.toUpperCase()}`, ""];
  for (const check of report.checks) {
    lines.push(check.passed ? `  ✓ ${check.name}` : `  ✗ ${check.name} — ${check.reason}`);
  }
  return lines.join("\n");
}

async function main() {
  const now = new Date("2026-06-15T12:00:00.000Z");
  const validSession: MockSession = { connected: true, expiresAt: "2026-07-01T00:00:00.000Z" };

  console.log("Run 1: all checks passing\n");
  const healthy = await runHealthAggregator({
    session: validSession,
    pingBackend: async () => true,
    pingRpc: async () => true,
    now,
  });
  console.log(formatReport(healthy));

  console.log("\n\nRun 2: RPC check deliberately failing\n");
  const degraded = await runHealthAggregator({
    session: validSession,
    pingBackend: async () => true,
    pingRpc: async () => false,
    now,
  });
  console.log(formatReport(degraded));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
