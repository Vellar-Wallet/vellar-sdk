/**
 * Issue #252: RPC Latency Instrumentation Hook.
 */

export interface RequestCompleteInfo {
  method: string;
  durationMs: number;
  success: boolean;
  error?: Error;
}

export type RequestCompleteHook = (info: RequestCompleteInfo) => void;

export async function instrumentRpcCall<T>(
  method: string,
  fn: () => Promise<T>,
  hook?: RequestCompleteHook
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    hook?.({
      method,
      durationMs: Date.now() - start,
      success: true,
    });
    return result;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    hook?.({
      method,
      durationMs: Date.now() - start,
      success: false,
      error,
    });
    throw error;
  }
}
