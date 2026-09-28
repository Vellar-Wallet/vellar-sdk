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
  maxReaderFailures?: number;
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
  const maxReaderFailures = options.maxReaderFailures ?? 3;
  let consecutiveReaderFailures = 0;

  const deadline = now() + timeoutMs;
  for (;;) {
    let status: TxStatus;
    try {
      status = await reader.getStatus(hash);
    } catch {
      consecutiveReaderFailures += 1;
      if (consecutiveReaderFailures >= maxReaderFailures) {
        throw new TransactionReaderError(hash, consecutiveReaderFailures);
      }
      if (now() + intervalMs > deadline) throw new TransactionTimeoutError(hash, timeoutMs);
      await sleep(intervalMs);
      continue;
    }
    consecutiveReaderFailures = 0;
    if (status !== "pending") return status;
    if (now() + intervalMs > deadline) throw new TransactionTimeoutError(hash, timeoutMs);
    await sleep(intervalMs);
  }
}
