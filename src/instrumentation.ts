/**
 * Issues #251, #252, #254 — Observability & Error Instrumentation Hooks.
 *
 * Provides:
 *   1. onError: Centralized error reporting hook for consumer apps (#251).
 *   2. onRequestComplete: Latency and duration instrumentation hook for RPC calls (#252).
 *   3. onElevatedErrorRate: Real-time alerting hook for elevated RPC failure rates (#254).
 */

export type ErrorReporterHook = (error: Error, context?: Record<string, unknown>) => void;

export interface RequestCompleteInfo {
  method: string;
  durationMs: number;
  success: boolean;
  error?: Error;
}

export type RequestCompleteHook = (info: RequestCompleteInfo) => void;

export interface ElevatedErrorRateStats {
  errorRate: number;
  totalRequests: number;
  failedRequests: number;
  threshold: number;
}

export type ElevatedErrorRateHook = (stats: ElevatedErrorRateStats) => void;

export interface RpcInstrumentationOptions {
  onError?: ErrorReporterHook;
  onRequestComplete?: RequestCompleteHook;
  onElevatedErrorRate?: ElevatedErrorRateHook;
  elevatedErrorRateThreshold?: number; // e.g. 0.25 (25%)
  windowSize?: number; // rolling window sample count (default: 20)
}

export class RpcErrorRateTracker {
  private readonly windowSize: number;
  private readonly threshold: number;
  private readonly results: boolean[] = []; // true = success, false = failure
  private readonly onElevatedErrorRate?: ElevatedErrorRateHook;

  constructor(options?: {
    threshold?: number;
    windowSize?: number;
    onElevatedErrorRate?: ElevatedErrorRateHook;
  }) {
    this.threshold = options?.threshold ?? 0.25;
    this.windowSize = options?.windowSize ?? 20;
    this.onElevatedErrorRate = options?.onElevatedErrorRate;
  }

  record(success: boolean): ElevatedErrorRateStats {
    this.results.push(success);
    if (this.results.length > this.windowSize) {
      this.results.shift();
    }

    const totalRequests = this.results.length;
    const failedRequests = this.results.filter((r) => !r).length;
    const errorRate = totalRequests > 0 ? failedRequests / totalRequests : 0;

    const stats: ElevatedErrorRateStats = {
      errorRate,
      totalRequests,
      failedRequests,
      threshold: this.threshold,
    };

    if (totalRequests >= 5 && errorRate >= this.threshold && this.onElevatedErrorRate) {
      this.onElevatedErrorRate(stats);
    }

    return stats;
  }

  getStats(): ElevatedErrorRateStats {
    const totalRequests = this.results.length;
    const failedRequests = this.results.filter((r) => !r).length;
    return {
      errorRate: totalRequests > 0 ? failedRequests / totalRequests : 0,
      totalRequests,
      failedRequests,
      threshold: this.threshold,
    };
  }

  reset(): void {
    this.results.length = 0;
  }
}

/**
 * Wraps an async RPC call with latency tracking, error reporting, and error rate monitoring.
 */
export async function withRpcInstrumentation<T>(
  method: string,
  fn: () => Promise<T>,
  options?: RpcInstrumentationOptions,
  tracker?: RpcErrorRateTracker
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - start;

    options?.onRequestComplete?.({
      method,
      durationMs,
      success: true,
    });

    tracker?.record(true);
    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    const error = err instanceof Error ? err : new Error(String(err));

    options?.onRequestComplete?.({
      method,
      durationMs,
      success: false,
      error,
    });

    options?.onError?.(error, { method, durationMs });
    tracker?.record(false);

    throw error;
  }
}
