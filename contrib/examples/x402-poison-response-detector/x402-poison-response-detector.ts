/**
 * Issue #246: Poison Response Detection for Malformed x402 Payment Responses.
 */

export class PoisonResponseError extends Error {
  constructor(public readonly endpoint: string, public readonly failureCount: number, message: string) {
    super(`[POISON_RESPONSE] Endpoint ${endpoint} returned ${failureCount} consecutive unparseable responses: ${message}`);
    this.name = "PoisonResponseError";
  }
}

export class PoisonResponseDetector {
  private readonly failureCounts = new Map<string, number>();

  constructor(
    public readonly maxParseFailures = 3,
    private readonly onPoisonDetected?: (endpoint: string, count: number) => void
  ) {}

  recordParseFailure(endpoint: string, reason: string): void {
    const current = (this.failureCounts.get(endpoint) ?? 0) + 1;
    this.failureCounts.set(endpoint, current);

    if (current >= this.maxParseFailures) {
      this.onPoisonDetected?.(endpoint, current);
      throw new PoisonResponseError(endpoint, current, reason);
    }
  }

  recordParseSuccess(endpoint: string): void {
    this.failureCounts.delete(endpoint);
  }

  getFailures(endpoint: string): number {
    return this.failureCounts.get(endpoint) ?? 0;
  }
}
