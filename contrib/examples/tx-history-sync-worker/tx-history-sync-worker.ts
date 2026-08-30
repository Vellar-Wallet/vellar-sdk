// Example: a worker that periodically polls a transaction source and
// appends only newly-seen transactions to a local in-memory history,
// deduplicating across polls whose results overlap — e.g. a source that
// always returns "the last N transactions" rather than only new ones since
// last poll.
//
// Run with: npx tsx tx-history-sync-worker.ts

export interface SyncedTransaction {
  id: string;
  amount: string;
}

export type TransactionSource = () => Promise<SyncedTransaction[]> | SyncedTransaction[];

export interface SyncState {
  history: SyncedTransaction[];
  seenIds: Set<string>;
}

export function createEmptyState(): SyncState {
  return { history: [], seenIds: new Set() };
}

/**
 * Merges one poll's `batch` into `state`, mutating it in place: any
 * transaction whose id has already been seen is skipped, everything else is
 * appended to history in the order it appears in the batch. Returns how
 * many were newly added.
 *
 * A plain seen-id set (rather than only comparing against a single "last
 * seen" cursor) is used so this stays correct even if the mock/real source
 * doesn't guarantee strict ordering across polls — the tracked "last seen
 * identifier" the worker reports (see `lastSeenId` below) is simply the id
 * of the most recently accepted transaction, derived from this set.
 */
export function mergeBatch(state: SyncState, batch: SyncedTransaction[]): number {
  let newCount = 0;
  for (const tx of batch) {
    if (state.seenIds.has(tx.id)) continue;
    state.seenIds.add(tx.id);
    state.history.push(tx);
    newCount++;
  }
  return newCount;
}

export interface SyncWorker {
  /** Runs one poll immediately, then again every `intervalMs`. Calling
   * start() while already running is a no-op. */
  start(): void;
  /** Stops future polling. The accumulated history is left intact. */
  stop(): void;
  /** A copy of every transaction seen so far, oldest first. */
  history(): SyncedTransaction[];
  /** The id of the most recently accepted transaction, or undefined before
   * the first successful poll. */
  lastSeenId(): string | undefined;
}

export function createSyncWorker(
  source: TransactionSource,
  intervalMs: number,
  log: (line: string) => void = () => {},
): SyncWorker {
  const state = createEmptyState();
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastId: string | undefined;

  async function pollOnce(): Promise<void> {
    const batch = await source();
    const newCount = mergeBatch(state, batch);
    if (newCount > 0) {
      lastId = state.history[state.history.length - 1]?.id;
    }
    log(`Poll: saw ${batch.length}, ${newCount} new (history size: ${state.history.length}, last seen id: ${lastId ?? "none"})`);
  }

  return {
    start() {
      if (timer) return;
      void pollOnce();
      timer = setInterval(() => void pollOnce(), intervalMs);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
    history: () => [...state.history],
    lastSeenId: () => lastId,
  };
}

async function main() {
  // A mock source whose results overlap between polls, like a "last N
  // transactions" feed rather than a strictly incremental one.
  const pages: SyncedTransaction[][] = [
    [{ id: "tx-1", amount: "10" }, { id: "tx-2", amount: "20" }],
    [{ id: "tx-2", amount: "20" }, { id: "tx-3", amount: "30" }], // tx-2 repeats
    [{ id: "tx-3", amount: "30" }, { id: "tx-4", amount: "40" }, { id: "tx-5", amount: "50" }], // tx-3 repeats
  ];
  let pageIndex = 0;
  const source: TransactionSource = () => pages[Math.min(pageIndex++, pages.length - 1)] ?? [];

  const state = createEmptyState();
  for (let i = 0; i < pages.length; i++) {
    const batch = await source();
    const newCount = mergeBatch(state, batch);
    console.log(`Poll ${i + 1}: saw ${batch.length}, ${newCount} new`);
  }

  console.log("Deduplicated history:", state.history);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
