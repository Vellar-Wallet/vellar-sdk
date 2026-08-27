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
  /**
   * How long finalized poll results (success/failed) are cached. Pending status
   * is never cached so poll loops stay fresh. Valid range: 0–60_000 ms; 0
   * disables caching. Default: 2_000.
   */
  cacheTtlMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface CachedTxStatusReaderOptions {
  /** TTL for cached final statuses. See WaitOptions.cacheTtlMs. Default: 2_000. */
  cacheTtlMs?: number;
  now?: () => number;
}

const DEFAULT_CACHE_TTL_MS = 2_000;
const MAX_CACHE_TTL_MS = 60_000;

function resolveCacheTtlMs(cacheTtlMs: number | undefined): number {
  const ttl = cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  if (!Number.isFinite(ttl) || ttl < 0 || ttl > MAX_CACHE_TTL_MS) {
    throw new RangeError(
      `cacheTtlMs must be between 0 and ${MAX_CACHE_TTL_MS}, got ${cacheTtlMs}`,
    );
  }
  return ttl;
}

/**
 * Wraps a TxStatusReader with a TTL cache for finalized statuses. Pending is
 * always fetched fresh so polling loops are not starved of updates.
 */
export function createCachedTxStatusReader(
  reader: TxStatusReader,
  options: CachedTxStatusReaderOptions = {},
): TxStatusReader {
  const cacheTtlMs = resolveCacheTtlMs(options.cacheTtlMs);
  const now = options.now ?? Date.now;
  const cache = new Map<string, { status: "success" | "failed"; expiresAt: number }>();

  if (cacheTtlMs === 0) {
    return reader;
  }

  return {
    async getStatus(hash) {
      const t = now();
      const cached = cache.get(hash);
      if (cached && cached.expiresAt > t) {
        return cached.status;
      }

      const status = await reader.getStatus(hash);
      if (status !== "pending") {
        cache.set(hash, { status, expiresAt: t + cacheTtlMs });
      }
      return status;
    },
  };
}

/** Polls until the transaction reaches a final state; throws TransactionTimeoutError on timeout. */
export async function waitForTransaction(
  reader: TxStatusReader,
  hash: string,
  options: WaitOptions = {},
): Promise<"success" | "failed"> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const cacheTtlMs = resolveCacheTtlMs(options.cacheTtlMs);
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;

  const effectiveReader =
    cacheTtlMs === 0
      ? reader
      : createCachedTxStatusReader(reader, { cacheTtlMs, now });

  const deadline = now() + timeoutMs;
  for (;;) {
    const status = await effectiveReader.getStatus(hash);
    if (status !== "pending") return status;
    if (now() + intervalMs > deadline) throw new TransactionTimeoutError(hash, timeoutMs);
    await sleep(intervalMs);
  }
}
