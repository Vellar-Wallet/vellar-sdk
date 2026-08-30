// Example: format an array of sample transaction records as an aligned
// text table for terminal output.
//
// Run with: npx tsx tx-history-table.ts

export interface TxRecord {
  hash: string;
  amount: string;
  timestamp: string;
}

/** Formats transactions as an aligned text table (hash, amount, timestamp).
 * An empty array prints a clear "no transactions" message instead of an
 * empty/headerless table. */
export function formatTxHistoryTable(transactions: TxRecord[]): string {
  if (transactions.length === 0) {
    return "No transactions.";
  }

  const headers = { hash: "HASH", amount: "AMOUNT", timestamp: "TIMESTAMP" };
  const hashWidth = Math.max(headers.hash.length, ...transactions.map((t) => t.hash.length));
  const amountWidth = Math.max(headers.amount.length, ...transactions.map((t) => t.amount.length));

  const row = (t: { hash: string; amount: string; timestamp: string }) =>
    `${t.hash.padEnd(hashWidth)}  ${t.amount.padStart(amountWidth)}  ${t.timestamp}`;

  const lines = [row(headers), "-".repeat(row(headers).length)];
  for (const tx of transactions) {
    lines.push(row(tx));
  }
  return lines.join("\n");
}

function main() {
  const sample: TxRecord[] = [
    { hash: "a1b2c3d4e5f6a7b8", amount: "100.5000000", timestamp: "2026-01-15T09:30:00Z" },
    { hash: "f6e5d4c3b2a1f0e9", amount: "2.5000000", timestamp: "2026-01-15T10:12:45Z" },
    { hash: "1234567890abcdef", amount: "1000.0000000", timestamp: "2026-01-16T08:00:00Z" },
  ];

  console.log("With transactions:");
  console.log(formatTxHistoryTable(sample));
  console.log();
  console.log("With an empty array:");
  console.log(formatTxHistoryTable([]));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
