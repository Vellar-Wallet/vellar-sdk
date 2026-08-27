# Balance history, paginated by cursor

`vellar-sdk/rpc`'s `createRpcBalanceReader()` answers "what's the balance
right now" — it has no notion of history, and pulling a wallet's whole
transfer log in one call doesn't scale for wallets with long histories
([#205](https://github.com/Vellar-Wallet/vellar-sdk/issues/205)). This adds
a `getBalanceHistory` query with cursor-based pagination: `after` / `limit`
in, `next_cursor` out — the same shape a REST list endpoint would use — with
a capped default and max page size.

## Why this lives in `contrib/`, not `src/`

Per [CONTRIBUTING.md](../../../CONTRIBUTING.md) and
[contrib/README.md](../../README.md), external contributor PRs may only
touch files under `contrib/`. This is built as a self-contained module on
top of `vellar-sdk/rpc`'s existing public exports (`RpcBalanceReaderOptions`)
rather than editing `src/balances-rpc.ts` directly, so it doesn't need that
exception.

## How pagination works

Soroban RPC's own `getEvents` already has cursor pagination built in — a
response carries a `cursor` string that resumes exactly where that call left
off. `queryBalanceHistory` wraps it with:

- A **bounded page size**: `limit` defaults to `DEFAULT_BALANCE_HISTORY_LIMIT`
  (20) and is capped at `MAX_BALANCE_HISTORY_LIMIT` (100) — a caller asking
  for more just gets the cap, not an error.
- A **`next_cursor` the caller doesn't have to compute**: it's the RPC's own
  cursor, echoed back once a page has at least one entry, and `null` once a
  page comes back empty (the stop signal for a paging loop).
- **Both transfer directions**: a holder's history includes transfers where
  they're the sender *or* the recipient. Soroban RPC's topic filters can't
  express "this position OR that position" in one filter, so this issues two
  filters (holder-as-sender, holder-as-recipient) that get OR'd together by
  `getEvents`.

```ts
import { queryBalanceHistory, createBalanceHistoryReader } from "./balance-history";

const reader = createBalanceHistoryReader({ rpcUrl, networkPassphrase });

// First page: start from a known ledger.
let page = await reader.getBalanceHistory(tokenContractId, holder, { startLedger, limit: 25 });
console.log(page.entries);

// Next page: resume from where the last one left off.
while (page.next_cursor) {
  page = await reader.getBalanceHistory(tokenContractId, holder, { after: page.next_cursor, limit: 25 });
  console.log(page.entries);
}
```

`startLedger` is required for the first page — Soroban RPC's `getEvents` has
no "just give me the latest" mode, it always needs either a starting ledger
or a resume cursor. A real caller typically gets this from
`server.getLatestLedger()` minus however far back it wants to look (see
`main()` in `balance-history.ts` for a worked example), or by persisting the
last cursor it saw between requests.

`queryBalanceHistory` takes a narrow `BalanceHistorySource` (just
`getEvents`) rather than a full `rpc.Server`, so it's directly unit-testable
with a fake — no live RPC round trip needed. `createBalanceHistoryReader`
wraps a real `rpc.Server` for actual use, mirroring
`createRpcBalanceReader`'s shape.

## Run it

```sh
npx tsx balance-history.ts <accountId> <tokenContractId> [startLedger]
```

Without `startLedger`, it defaults to roughly the last 1000 ledgers on
testnet — enough for a quick demo, not a real retention-window calculation.

## Tests

```sh
npx vitest run contrib/examples/balance-history-pagination
```

Covers:

- **First page** — `startLedger` given, entries decoded (from/to/amount/
  ledger/etc.), `next_cursor` returned from the RPC response.
- **Middle page** — resuming with `after`, request built with `cursor`
  instead of `startLedger`.
- **Empty result** — `next_cursor` is `null` when a page has no entries.
- Default and capped `limit` (including rejecting a non-positive or
  non-integer one).
- Requiring `startLedger` or `after`, with `after` taking priority when
  both are given.
- Both transfer-direction filters being sent, and a malformed event
  producing a descriptive error instead of a silent bad decode.
