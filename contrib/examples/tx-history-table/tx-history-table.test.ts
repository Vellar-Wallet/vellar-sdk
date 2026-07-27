import { describe, expect, it } from "vitest";
import { formatTxHistoryTable } from "./tx-history-table";

describe("formatTxHistoryTable", () => {
  it("prints a clear message for an empty array", () => {
    expect(formatTxHistoryTable([])).toBe("No transactions.");
  });

  it("includes a header row with hash, amount, and timestamp columns", () => {
    const table = formatTxHistoryTable([{ hash: "abc123", amount: "10.0000000", timestamp: "2026-01-01T00:00:00Z" }]);
    expect(table).toContain("HASH");
    expect(table).toContain("AMOUNT");
    expect(table).toContain("TIMESTAMP");
  });

  it("includes a row for each transaction", () => {
    const table = formatTxHistoryTable([
      { hash: "hash1", amount: "1.0000000", timestamp: "2026-01-01T00:00:00Z" },
      { hash: "hash2", amount: "2.0000000", timestamp: "2026-01-02T00:00:00Z" },
    ]);
    expect(table).toContain("hash1");
    expect(table).toContain("hash2");
  });

  it("right-aligns the amount column for readability", () => {
    const table = formatTxHistoryTable([
      { hash: "h1", amount: "1", timestamp: "t1" },
      { hash: "h2", amount: "1000000", timestamp: "t2" },
    ]);
    const lines = table.split("\n");
    // Both amount values should end at the same column position.
    const amountEnd1 = lines[2]!.indexOf("t1");
    const amountEnd2 = lines[3]!.indexOf("t2");
    expect(amountEnd1).toBe(amountEnd2);
  });
});
