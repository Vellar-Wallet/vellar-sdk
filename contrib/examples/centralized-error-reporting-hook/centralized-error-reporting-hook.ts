/**
 * Issue #251: Centralized Error Reporting Hook Interface.
 */

export type ErrorReporterHook = (error: Error, context?: Record<string, unknown>) => void;

export class ClientWithErrorReporting {
  constructor(private readonly onError?: ErrorReporterHook) {}

  async execute<T>(fn: () => Promise<T>, context?: Record<string, unknown>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.onError?.(error, context);
      throw error;
    }
  }
}
