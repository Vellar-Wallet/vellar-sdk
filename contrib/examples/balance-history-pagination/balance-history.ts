// Example: cursor-paginated balance-history queries against Soroban RPC.
//
// vellar-sdk/rpc's createRpcBalanceReader() answers "what's the balance
// right now" — it has no notion of history. Building a history view means
// walking a SEP-41 token's `transfer` events for a holder, and a wallet with
// a long history can't pull that whole log in one RPC call. This wraps
// Soroban RPC's getEvents in a small `after`/`limit` → `next_cursor` page
// contract (the shape a REST list endpoint would use), with a capped
// default and max page size, so callers page through history in bounded
// chunks instead of one unbounded fetch.
//
// Soroban RPC's own getEvents cursor already IS this: a `getEvents`
// response carries a `cursor` string that resumes exactly where that call
// left off. This module just gives it a bounded, self-describing page
// shape and enforces the page-size cap the SDK doesn't have an opinion on
// today.
//
// Run with: npx tsx balance-history.ts <accountId> <tokenContractId> [startLedger]

import { Address, nativeToScVal, rpc, scValToBigInt } from "@stellar/stellar-sdk";
import { TESTNET } from "../../../src/config";
import type { RpcBalanceReaderOptions } from "../../../src/rpc";

/** Page size when `limit` is omitted from a query. */
export const DEFAULT_BALANCE_HISTORY_LIMIT = 20;
/** Hard ceiling on page size — a caller-supplied `limit` above this is capped, not rejected. */
export const MAX_BALANCE_HISTORY_LIMIT = 100;

export interface BalanceHistoryEntry {
  /** This event's own cursor. Passing it as `after` resumes just past it. */
  cursor: string;
  from: string;
  to: string;
  /** Raw token units transferred (e.g. stroops for XLM), always positive. */
  amount: bigint;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
}

export interface BalanceHistoryPage {
  entries: BalanceHistoryEntry[];
  /** Cursor for the next page. Null once a page comes back empty — that's the stop signal. */
  next_cursor: string | null;
}

export interface BalanceHistoryQuery {
  /**
   * Ledger to start scanning from (inclusive). Required for the first page —
   * Soroban RPC's getEvents has no "just give me the latest" mode, it always
   * needs either a starting ledger or a cursor from a prior call. Ignored
   * once `after` is set.
   */
  startLedger?: number;
  /** Resume from a previous page's `next_cursor`. Takes priority over `startLedger`. */
  after?: string;
  /** Page size, capped at MAX_BALANCE_HISTORY_LIMIT. Defaults to DEFAULT_BALANCE_HISTORY_LIMIT. */
  limit?: number;
}

/**
 * The slice of `rpc.Server` this needs. Narrowed to one method so tests can
 * inject a fake instead of a real Server (and a real Server structurally
 * satisfies it, no adapter needed).
 */
export interface BalanceHistorySource {
  getEvents(request: rpc.Api.GetEventsRequest): Promise<rpc.Api.GetEventsResponse>;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_BALANCE_HISTORY_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`limit must be a positive integer, got ${limit}`);
  }
  return Math.min(limit, MAX_BALANCE_HISTORY_LIMIT);
}

/**
 * Two filters, OR'd together by getEvents: `holder` as sender, and `holder`
 * as recipient. That's the only way to cover both directions of a
 * `transfer(from, to)` event, since a single filter's topic wildcards can't
 * express "this position OR that position".
 */
function transferFilters(tokenContractId: string, holder: string): rpc.Api.EventFilter[] {
  const transferTopic = nativeToScVal("transfer", { type: "symbol" }).toXDR("base64");
  const holderTopic = new Address(holder).toScVal().toXDR("base64");
  return [
    { type: "contract", contractIds: [tokenContractId], topics: [[transferTopic, holderTopic, "*"]] },
    { type: "contract", contractIds: [tokenContractId], topics: [[transferTopic, "*", holderTopic]] },
  ];
}

/** Decodes a SEP-41 `transfer(from: Address, to: Address, amount: i128)` event. */
function decodeTransferEvent(event: rpc.Api.EventResponse): BalanceHistoryEntry {
  const [, fromTopic, toTopic] = event.topic;
  if (!fromTopic || !toTopic) {
    throw new Error(
      `malformed transfer event ${event.id}: expected topics (symbol, from, to), got ${event.topic.length}`,
    );
  }
  return {
    cursor: event.id,
    from: Address.fromScVal(fromTopic).toString(),
    to: Address.fromScVal(toTopic).toString(),
    amount: scValToBigInt(event.value),
    ledger: event.ledger,
    ledgerClosedAt: event.ledgerClosedAt,
    txHash: event.txHash,
  };
}

/**
 * Fetches one page of `transfer` events into or out of `holder` for
 * `tokenContractId`.
 *
 * - First page: pass `startLedger` (omit `after`).
 * - Later pages: pass `after: previousPage.next_cursor`.
 * - Stop once a page comes back with `next_cursor: null`.
 */
export async function queryBalanceHistory(
  source: BalanceHistorySource,
  tokenContractId: string,
  holder: string,
  query: BalanceHistoryQuery = {},
): Promise<BalanceHistoryPage> {
  const limit = clampLimit(query.limit);
  const filters = transferFilters(tokenContractId, holder);

  let response: rpc.Api.GetEventsResponse;
  if (query.after !== undefined) {
    response = await source.getEvents({ filters, cursor: query.after, limit });
  } else if (query.startLedger !== undefined) {
    response = await source.getEvents({ filters, startLedger: query.startLedger, limit });
  } else {
    throw new RangeError("queryBalanceHistory: pass `startLedger` for the first page, or `after` to resume one");
  }

  const entries = response.events.map(decodeTransferEvent);
  return { entries, next_cursor: entries.length > 0 ? response.cursor : null };
}

/** Wraps a real `rpc.Server` so callers don't have to construct one themselves. */
export function createBalanceHistoryReader(options: RpcBalanceReaderOptions): {
  getBalanceHistory(
    tokenContractId: string,
    holder: string,
    query?: BalanceHistoryQuery,
  ): Promise<BalanceHistoryPage>;
} {
  const server = new rpc.Server(options.rpcUrl);
  return {
    getBalanceHistory: (tokenContractId, holder, query) =>
      queryBalanceHistory(server, tokenContractId, holder, query),
  };
}

async function main() {
  const [accountId, tokenContractId, startLedgerArg] = process.argv.slice(2);
  if (!accountId || !tokenContractId) {
    console.error("Usage: npx tsx balance-history.ts <accountId> <tokenContractId> [startLedger]");
    process.exitCode = 1;
    return;
  }

  const server = new rpc.Server(TESTNET.rpcUrl);
  // Demo default: recent ledgers only, since RPC providers only retain a
  // limited event window (often far short of Soroban's own 7-day cap) — a
  // real caller should track and pass its own startLedger.
  const startLedger = startLedgerArg
    ? Number(startLedgerArg)
    : (await server.getLatestLedger()).sequence - 1000;

  try {
    let cursor: string | undefined;
    let page = 1;
    for (;;) {
      const result = await queryBalanceHistory(server, tokenContractId, accountId, {
        startLedger: cursor ? undefined : startLedger,
        after: cursor,
        limit: 20,
      });
      console.log(`Page ${page}: ${result.entries.length} transfer(s)`);
      for (const entry of result.entries) {
        console.log(`  ledger ${entry.ledger}  ${entry.from} -> ${entry.to}  amount=${entry.amount}`);
      }
      if (!result.next_cursor) break;
      cursor = result.next_cursor;
      page++;
    }
  } catch (err) {
    console.error(`Error reading balance history: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
