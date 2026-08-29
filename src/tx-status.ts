import type { OnRetryHook } from "./types";

// Transaction status tracking (idea.md §6.1 TransactionStatusTracker:
// "status is tracked until final result"). Pure polling logic; the RPC-backed
// reader lives under the /rpc subpath.

export type TxStatus = "pending" | "success" | "failed";

export interface TxStatusReader {
  getStatus(hash: string): Promise<TxStatus>;
}

export class TransactionTimeoutError extends Error {
  constructor(hash: string, timeoutMs: number) {
    super(`Transaction ${hash} was still pending after ${timeoutMs}ms`);
    this.name = "TransactionTimeoutError";
  }
}

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Optional structured logging hook invoked on each polling/retry attempt. */
  onRetry?: OnRetryHook;
}

/** Polls until the transaction reaches a final state; throws TransactionTimeoutError on timeout. */
export async function waitForTransaction(
  reader: TxStatusReader,
  hash: string,
  options: WaitOptions = {},
): Promise<"success" | "failed"> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const onRetry = options.onRetry;

  const deadline = now() + timeoutMs;
  let attempt = 0;
  for (;;) {
    attempt++;
    let status: TxStatus;
    try {
      status = await reader.getStatus(hash);
    } catch (err) {
      if (onRetry) {
        try {
          await onRetry({
            attempt,
            error: err,
            hash,
            operation: "waitForTransaction",
          });
        } catch {}
      }
      throw err;
    }

    if (status !== "pending") return status;

    if (onRetry) {
      try {
        await onRetry({
          attempt,
          hash,
          operation: "waitForTransaction",
          status: "pending",
        });
      } catch {
        // Structured logging hook errors should not abort transaction polling
      }
    }

    if (now() + intervalMs > deadline) {
      const timeoutErr = new TransactionTimeoutError(hash, timeoutMs);
      if (onRetry) {
        try {
          await onRetry({
            attempt: attempt + 1,
            error: timeoutErr,
            hash,
            operation: "waitForTransaction",
          });
        } catch {}
      }
      throw timeoutErr;
    }
    await sleep(intervalMs);
  }
}
