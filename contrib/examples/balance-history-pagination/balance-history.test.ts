import { Address, Keypair, nativeToScVal, rpc } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import {
  createBalanceHistoryReader,
  DEFAULT_BALANCE_HISTORY_LIMIT,
  MAX_BALANCE_HISTORY_LIMIT,
  queryBalanceHistory,
  type BalanceHistorySource,
} from "./balance-history";

const TOKEN = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const HOLDER = Keypair.random().publicKey();
const OTHER = Keypair.random().publicKey();

function transferEvent(opts: { id: string; from: string; to: string; amount: bigint; ledger?: number }): rpc.Api.EventResponse {
  return {
    id: opts.id,
    type: "contract",
    ledger: opts.ledger ?? 100,
    ledgerClosedAt: "2026-08-28T00:00:00Z",
    transactionIndex: 1,
    operationIndex: 0,
    inSuccessfulContractCall: true,
    txHash: `hash-${opts.id}`,
    topic: [
      nativeToScVal("transfer", { type: "symbol" }),
      new Address(opts.from).toScVal(),
      new Address(opts.to).toScVal(),
    ],
    value: nativeToScVal(opts.amount, { type: "i128" }),
  };
}

function eventsResponse(events: rpc.Api.EventResponse[], cursor: string): rpc.Api.GetEventsResponse {
  return {
    events,
    cursor,
    latestLedger: 1000,
    oldestLedger: 1,
    latestLedgerCloseTime: "2026-08-28T00:00:00Z",
    oldestLedgerCloseTime: "2026-08-01T00:00:00Z",
  };
}

describe("queryBalanceHistory", () => {
  it("fetches a first page from startLedger and returns a next_cursor", async () => {
    const source: BalanceHistorySource = {
      getEvents: vi
        .fn()
        .mockResolvedValue(
          eventsResponse(
            [
              transferEvent({ id: "e1", from: HOLDER, to: OTHER, amount: 100n, ledger: 10 }),
              transferEvent({ id: "e2", from: OTHER, to: HOLDER, amount: 50n, ledger: 11 }),
            ],
            "cursor-page-1",
          ),
        ),
    };

    const page = await queryBalanceHistory(source, TOKEN, HOLDER, { startLedger: 5 });

    expect(page.entries).toEqual([
      { cursor: "e1", from: HOLDER, to: OTHER, amount: 100n, ledger: 10, ledgerClosedAt: "2026-08-28T00:00:00Z", txHash: "hash-e1" },
      { cursor: "e2", from: OTHER, to: HOLDER, amount: 50n, ledger: 11, ledgerClosedAt: "2026-08-28T00:00:00Z", txHash: "hash-e2" },
    ]);
    expect(page.next_cursor).toBe("cursor-page-1");

    expect(source.getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ startLedger: 5, limit: DEFAULT_BALANCE_HISTORY_LIMIT }),
    );
    const request = (source.getEvents as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    // Both transfer directions are covered by two OR'd filters.
    expect(request.filters).toHaveLength(2);
    expect(request.filters[0].topics[0][1]).not.toBe("*");
    expect(request.filters[0].topics[0][2]).toBe("*");
    expect(request.filters[1].topics[0][1]).toBe("*");
    expect(request.filters[1].topics[0][2]).not.toBe("*");
  });

  it("fetches a middle page by resuming from a previous next_cursor", async () => {
    const source: BalanceHistorySource = {
      getEvents: vi
        .fn()
        .mockResolvedValue(
          eventsResponse(
            [transferEvent({ id: "e3", from: HOLDER, to: OTHER, amount: 25n, ledger: 20 })],
            "cursor-page-2",
          ),
        ),
    };

    const page = await queryBalanceHistory(source, TOKEN, HOLDER, { after: "cursor-page-1", limit: 5 });

    expect(page.entries).toHaveLength(1);
    expect(page.next_cursor).toBe("cursor-page-2");
    expect(source.getEvents).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "cursor-page-1", limit: 5 }),
    );
  });

  it("returns an empty page with a null next_cursor when nothing matches", async () => {
    const source: BalanceHistorySource = {
      getEvents: vi.fn().mockResolvedValue(eventsResponse([], "cursor-unused")),
    };

    const page = await queryBalanceHistory(source, TOKEN, HOLDER, { startLedger: 5 });

    expect(page.entries).toEqual([]);
    expect(page.next_cursor).toBeNull();
  });

  it("defaults limit to DEFAULT_BALANCE_HISTORY_LIMIT when omitted", async () => {
    const source: BalanceHistorySource = { getEvents: vi.fn().mockResolvedValue(eventsResponse([], "c")) };
    await queryBalanceHistory(source, TOKEN, HOLDER, { startLedger: 1 });
    expect(source.getEvents).toHaveBeenCalledWith(expect.objectContaining({ limit: DEFAULT_BALANCE_HISTORY_LIMIT }));
  });

  it("caps a requested limit at MAX_BALANCE_HISTORY_LIMIT instead of rejecting it", async () => {
    const source: BalanceHistorySource = { getEvents: vi.fn().mockResolvedValue(eventsResponse([], "c")) };
    await queryBalanceHistory(source, TOKEN, HOLDER, { startLedger: 1, limit: 5000 });
    expect(source.getEvents).toHaveBeenCalledWith(expect.objectContaining({ limit: MAX_BALANCE_HISTORY_LIMIT }));
  });

  it("rejects a non-positive or non-integer limit without calling the source", async () => {
    const source: BalanceHistorySource = { getEvents: vi.fn() };
    await expect(queryBalanceHistory(source, TOKEN, HOLDER, { startLedger: 1, limit: 0 })).rejects.toThrow(RangeError);
    await expect(queryBalanceHistory(source, TOKEN, HOLDER, { startLedger: 1, limit: -3 })).rejects.toThrow(RangeError);
    await expect(queryBalanceHistory(source, TOKEN, HOLDER, { startLedger: 1, limit: 1.5 })).rejects.toThrow(RangeError);
    expect(source.getEvents).not.toHaveBeenCalled();
  });

  it("requires either startLedger or after", async () => {
    const source: BalanceHistorySource = { getEvents: vi.fn() };
    await expect(queryBalanceHistory(source, TOKEN, HOLDER)).rejects.toThrow(RangeError);
    expect(source.getEvents).not.toHaveBeenCalled();
  });

  it("prefers after over startLedger when both are given", async () => {
    const source: BalanceHistorySource = { getEvents: vi.fn().mockResolvedValue(eventsResponse([], "c")) };
    await queryBalanceHistory(source, TOKEN, HOLDER, { startLedger: 1, after: "resume-here" });
    const request = (source.getEvents as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(request.cursor).toBe("resume-here");
    expect(request.startLedger).toBeUndefined();
  });

  it("throws a descriptive error for a malformed transfer event", async () => {
    const badEvent = transferEvent({ id: "e1", from: HOLDER, to: OTHER, amount: 1n });
    badEvent.topic = [badEvent.topic[0]!]; // drop from/to
    const source: BalanceHistorySource = {
      getEvents: vi.fn().mockResolvedValue(eventsResponse([badEvent], "c")),
    };
    await expect(queryBalanceHistory(source, TOKEN, HOLDER, { startLedger: 1 })).rejects.toThrow(/malformed transfer event/);
  });
});

describe("createBalanceHistoryReader", () => {
  it("returns an object exposing getBalanceHistory without making a network call", () => {
    const reader = createBalanceHistoryReader({
      rpcUrl: "https://rpc.example.invalid",
      networkPassphrase: "Test SDF Network ; September 2015",
    });
    expect(typeof reader.getBalanceHistory).toBe("function");
  });
});
