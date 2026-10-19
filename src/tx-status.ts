// Transaction status tracking (idea.md §6.1 TransactionStatusTracker:
// "status is tracked until final result"). Pure polling logic; the RPC-backed
// reader lives under the /rpc subpath.

export type TxStatus = "pending" | "success" | "failed";

export interface TxStatusReader {
  getStatus(hash: string): Promise<TxStatus>;
}

/**
 * Thrown when a transaction never left "pending" within the polling deadline.
 * This means the relayer accepted the submission but its status endpoint never
 * reported a final status (a stuck relayer-side job, or a persistent status
 * outage); it is NOT an on-chain failure. A transaction that failed on-chain
 * resolves waitForTransaction with "failed" instead of throwing. Look the hash
 * up on the network before resubmitting, since the transaction may still land.
 */
export class TransactionTimeoutError extends Error {
  constructor(
    readonly hash: string,
    readonly timeoutMs: number,
  ) {
    super(
      `Transaction ${hash} was still pending after ${timeoutMs}ms: the relayer never reported a final status (not an on-chain failure)`,
    );
    this.name = "TransactionTimeoutError";
  }
}

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Polls until the transaction reaches a final state. Defaults: 60s deadline
 * (timeoutMs) polled every 2s (intervalMs), so a status that stays "pending"
 * is read at most 31 times. When the deadline passes it throws
 * TransactionTimeoutError; an on-chain failure resolves "failed" instead.
 */
export async function waitForTransaction(
  reader: TxStatusReader,
  hash: string,
  options: WaitOptions = {},
): Promise<"success" | "failed"> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;

  const deadline = now() + timeoutMs;
  for (;;) {
    let status: TxStatus;
    try {
      status = await reader.getStatus(hash);
    } catch {
      // Transient network drop mid-poll (e.g. the RPC reader threw): back off
      // and keep polling instead of bailing — recovery eventually resolves.
      // Only a drop that outlives the whole deadline surfaces as a timeout.
      if (now() + intervalMs > deadline) throw new TransactionTimeoutError(hash, timeoutMs);
      await sleep(intervalMs);
      continue;
    }
    if (status !== "pending") return status;
    if (now() + intervalMs > deadline) throw new TransactionTimeoutError(hash, timeoutMs);
    await sleep(intervalMs);
  }
}
