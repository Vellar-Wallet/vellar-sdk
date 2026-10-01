/**
 * Spend-attribution ledger — reference implementation for #458.
 *
 * Append-only spend record keyed by resource and agent, layered alongside
 * the running totals in the MCP payer ledger. Records confirmed and
 * indeterminate settlements. Never carries secrets or signatures.
 *
 * This file is a self-contained example; the real module would live in
 * packages/mcp-x402-payer/src/.
 */

export type SettlementKind = "confirmed" | "indeterminate";

export interface SpendRecord {
  /** Resource URL that was paid for. */
  resourceUrl: string;
  /** Asset (SAC contract id) used for payment. */
  asset: string;
  /** Amount in base units. */
  amount: bigint;
  /** On-chain settlement hash (empty for indeterminate). */
  settlementHash: string;
  /** Whether the settlement was confirmed or indeterminate. */
  settlementKind: SettlementKind;
  /** ISO timestamp. */
  timestamp: string;
}

export interface SpendSummary {
  totalByAsset: Record<string, bigint>;
  countByResource: Record<string, number>;
  records: readonly SpendRecord[];
}

/**
 * Create an append-only spend ledger. The record is write-once; the query
 * surface is read-only so nothing can rewrite spend history.
 */
export function createSpendLedger() {
  const records: SpendRecord[] = [];
  const totalByAsset: Record<string, bigint> = {};

  function append(record: Omit<SpendRecord, "timestamp">): void {
    const entry: SpendRecord = {
      ...record,
      timestamp: new Date().toISOString(),
    };
    records.push(entry);
    totalByAsset[entry.asset] = (totalByAsset[entry.asset] ?? 0n) + entry.amount;
  }

  function summary(): SpendSummary {
    const countByResource: Record<string, number> = {};
    for (const r of records) {
      countByResource[r.resourceUrl] = (countByResource[r.resourceUrl] ?? 0) + 1;
    }
    return { totalByAsset: { ...totalByAsset }, countByResource, records: [...records] };
  }

  return { append, summary };
}