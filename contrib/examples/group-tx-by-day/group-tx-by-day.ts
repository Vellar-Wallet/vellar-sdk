// Standalone example: group an array of sample transactions (with
// timestamps) into buckets keyed by calendar day, oldest day first.

import type { TxStatus } from "../../../src/tx-status";

/** A minimal "transaction history item" shape. The SDK doesn't ship a
 * dedicated history type; this mirrors how `src/tx-status.ts`'s `TxStatus`
 * and the ISO timestamps used elsewhere in the SDK (e.g. `WalletSession`,
 * `GeneratedPolicy`) would typically be combined for a wallet activity feed. */
export interface SampleTransaction {
  hash: string;
  /** ISO 8601 timestamp string. */
  timestamp: string;
  amount: string;
  status: TxStatus;
}

export interface DayGroup {
  /** Calendar day key, UTC, `YYYY-MM-DD`. */
  day: string;
  transactions: SampleTransaction[];
}

function dayKey(timestamp: string): string {
  const iso = new Date(timestamp).toISOString();
  return iso.slice(0, 10);
}

/** Groups `transactions` by their UTC calendar day, using `timestamp` as the
 * day key. Groups are returned in chronological order (oldest day first);
 * within a group, transactions keep their input order. */
export function groupTransactionsByDay(transactions: SampleTransaction[]): DayGroup[] {
  const byDay = new Map<string, SampleTransaction[]>();
  for (const tx of transactions) {
    const key = dayKey(tx.timestamp);
    const bucket = byDay.get(key);
    if (bucket) {
      bucket.push(tx);
    } else {
      byDay.set(key, [tx]);
    }
  }
  return [...byDay.keys()].sort().map((day) => ({ day, transactions: byDay.get(day)! }));
}

const SAMPLE_TRANSACTIONS: SampleTransaction[] = [
  { hash: "tx-1", timestamp: "2026-07-20T09:15:00Z", amount: "10.0000000", status: "success" },
  { hash: "tx-2", timestamp: "2026-07-20T18:42:00Z", amount: "2.5000000", status: "success" },
  { hash: "tx-3", timestamp: "2026-07-22T08:03:00Z", amount: "1.2500000", status: "pending" },
  { hash: "tx-4", timestamp: "2026-07-25T23:59:59Z", amount: "5.0000000", status: "failed" },
  { hash: "tx-5", timestamp: "2026-07-26T00:00:01Z", amount: "7.0000000", status: "success" },
];

export function main(): void {
  const groups = groupTransactionsByDay(SAMPLE_TRANSACTIONS);
  for (const group of groups) {
    console.log(`${group.day}: ${group.transactions.length} transaction(s)`);
    for (const tx of group.transactions) {
      console.log(`  ${tx.hash} ${tx.timestamp} ${tx.status}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
