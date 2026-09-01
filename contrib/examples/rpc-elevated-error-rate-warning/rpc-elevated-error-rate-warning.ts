/**
 * Issue #254: Configurable Elevated RPC Error Rate Callback.
 */

export interface ErrorRateStats {
  errorRate: number;
  totalRequests: number;
  failedRequests: number;
  threshold: number;
}

export type ElevatedErrorRateCallback = (stats: ErrorRateStats) => void;

export class RpcErrorRateMonitor {
  private readonly history: boolean[] = [];

  constructor(
    private readonly threshold = 0.25,
    private readonly windowSize = 20,
    private readonly onElevatedErrorRate?: ElevatedErrorRateCallback
  ) {}

  record(success: boolean): ErrorRateStats {
    this.history.push(success);
    if (this.history.length > this.windowSize) {
      this.history.shift();
    }

    const totalRequests = this.history.length;
    const failedRequests = this.history.filter((s) => !s).length;
    const errorRate = totalRequests > 0 ? failedRequests / totalRequests : 0;

    const stats: ErrorRateStats = {
      errorRate,
      totalRequests,
      failedRequests,
      threshold: this.threshold,
    };

    if (totalRequests >= 5 && errorRate >= this.threshold) {
      this.onElevatedErrorRate?.(stats);
    }

    return stats;
  }
}
