# Transaction history sync worker

A worker that periodically polls a transaction source and appends only
newly-seen transactions to a local in-memory history — safe against a
source whose results **overlap between polls** (e.g. "the last N
transactions" rather than strictly incremental results).

## How dedup works

`mergeBatch` tracks every id it has ever accepted in a `Set`, so a
transaction that reappears in a later poll (because the source's window
overlapped with the previous one) is silently skipped rather than
re-appended. The worker also exposes `lastSeenId()` — the id of the most
recently *accepted* transaction — for observability, derived from the same
dedup state rather than being a second, separately-tracked cursor that could
drift out of sync with it.

## Usage

```ts
import { createSyncWorker } from "./tx-history-sync-worker";

const worker = createSyncWorker(fetchLatestTransactions, 5000);
worker.start(); // polls immediately, then every 5s

// later
worker.history();   // every transaction seen so far, oldest first, deduplicated
worker.lastSeenId(); // the most recently accepted transaction's id
worker.stop();       // stop polling; history is preserved
```

## Run it

```sh
npx tsx tx-history-sync-worker.ts
```

Expected output (three polls, each overlapping the previous one by one
transaction):

```
Poll 1: saw 2, 2 new
Poll 2: saw 2, 1 new
Poll 3: saw 3, 2 new
Deduplicated history: [
  { id: 'tx-1', amount: '10' },
  { id: 'tx-2', amount: '20' },
  { id: 'tx-3', amount: '30' },
  { id: 'tx-4', amount: '40' },
  { id: 'tx-5', amount: '50' }
]
```

## Tests

```sh
npx vitest run contrib/examples/tx-history-sync-worker
```

`mergeBatch` (the dedup core) is tested directly with plain arrays; the
`createSyncWorker` interval/start/stop behavior is tested with vitest's fake
timers.
