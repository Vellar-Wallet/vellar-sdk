/**
 * Dependency scanner and vulnerability audit utility for SDK packages (Issue #257).
 * Parses dependency vulnerability reports, evaluates severity thresholds, and
 * enforces documented risk exceptions.
 */

export type VulnerabilitySeverity = "info" | "low" | "moderate" | "high" | "critical";

export interface VulnerabilityRecord {
  id: string;
  name: string;
  severity: VulnerabilitySeverity;
  range?: string;
  url?: string;
  title?: string;
}

export interface DependencyAuditException {
  id: string;
  name: string;
  reason: string;
  expiresAt?: string;
  approvedBy?: string;
}

export interface AuditScanOptions {
  failSeverity?: VulnerabilitySeverity;
  exceptions?: DependencyAuditException[];
  now?: () => Date;
}

export interface AuditScanResult {
  passed: boolean;
  totalVulnerabilities: number;
  failingCount: number;
  exemptedCount: number;
  failing: VulnerabilityRecord[];
  exempted: VulnerabilityRecord[];
}

const SEVERITY_LEVELS: Record<VulnerabilitySeverity, number> = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

export function scanVulnerabilities(
  vulnerabilities: VulnerabilityRecord[],
  options: AuditScanOptions = {},
): AuditScanResult {
  const failSeverity = options.failSeverity ?? "high";
  const failLevel = SEVERITY_LEVELS[failSeverity];
  const exceptions = options.exceptions ?? [];
  const now = options.now ? options.now() : new Date();

  const activeExceptions = new Map<string, DependencyAuditException>();
  for (const ex of exceptions) {
    if (ex.expiresAt && new Date(ex.expiresAt) < now) {
      continue; // Expired exception is ignored
    }
    activeExceptions.set(ex.id, ex);
    activeExceptions.set(ex.name, ex);
  }

  const failing: VulnerabilityRecord[] = [];
  const exempted: VulnerabilityRecord[] = [];

  for (const v of vulnerabilities) {
    const level = SEVERITY_LEVELS[v.severity] ?? 0;
    if (level >= failLevel) {
      if (activeExceptions.has(v.id) || activeExceptions.has(v.name)) {
        exempted.push(v);
      } else {
        failing.push(v);
      }
    }
  }

  return {
    passed: failing.length === 0,
    totalVulnerabilities: vulnerabilities.length,
    failingCount: failing.length,
    exemptedCount: exempted.length,
    failing,
    exempted,
  };
}
