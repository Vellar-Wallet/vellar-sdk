import { describe, expect, it } from "vitest";
import { groupTransactionsByDay, type SampleTransaction } from "./group-tx-by-day";

const TRANSACTIONS: SampleTransaction[] = [
  { hash: "tx-b", timestamp: "2026-01-02T10:00:00Z", amount: "1", status: "success" },
  { hash: "tx-a", timestamp: "2026-01-01T23:00:00Z", amount: "2", status: "success" },
  { hash: "tx-c", timestamp: "2026-01-01T01:00:00Z", amount: "3", status: "pending" },
  { hash: "tx-d", timestamp: "2026-01-03T00:00:01Z", amount: "4", status: "failed" },
];

describe("groupTransactionsByDay", () => {
  it("buckets transactions spanning three days into three chronologically ordered groups", () => {
    const groups = groupTransactionsByDay(TRANSACTIONS);

    expect(groups.map((g) => g.day)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
    expect(groups[0]!.transactions.map((t) => t.hash)).toEqual(["tx-a", "tx-c"]);
    expect(groups[1]!.transactions.map((t) => t.hash)).toEqual(["tx-b"]);
    expect(groups[2]!.transactions.map((t) => t.hash)).toEqual(["tx-d"]);
  });

  it("returns an empty array for no transactions", () => {
    expect(groupTransactionsByDay([])).toEqual([]);
  });
});
