# x402 Discovery Pagination

Self-contained reference for issue [#212](https://github.com/Vellar-Wallet/vellar-sdk/issues/212): cursor-based pagination for x402 resource discovery, so a growing facilitator catalog does not make every discovery call slower.

## Run tests

```bash
npx vitest run contrib/examples/issue-212-x402-discovery-pagination/x402-discovery-pagination.test.ts
```

## Page size limits

Follows the batch balance convention in `src/balances.ts` (`MAX_BATCH_BALANCE_SIZE` / `BatchBalanceSizeError`): a named max constant plus a typed error. An over-large request is **rejected, not clamped**, so a caller never believes it received more than it did.

| Constant | Value | Notes |
|----------|-------|-------|
| `DEFAULT_DISCOVERY_PAGE_SIZE` | `20` | Used when `limit` is omitted |
| `MAX_DISCOVERY_PAGE_SIZE` | `100` | `limit` above this throws `DiscoveryPageSizeError` |

`limit` must be a positive integer; `0`, negatives, and non-integers throw `RangeError`. The limit is validated *before* the source is read, so a bad request fails fast rather than after a full catalog fetch.

## Usage

```ts
import { createX402DiscoveryClient, createHttpDiscoverySource } from "./x402-discovery-pagination";

const client = createX402DiscoveryClient(
  createHttpDiscoverySource("https://facilitator.example/catalog"),
);

let cursor: string | undefined;
do {
  const page = await client.discover({ limit: 25, cursor, network: "stellar:testnet" });
  for (const r of page.resources) console.log(r.resource);
  cursor = page.next_cursor ?? undefined;
} while (cursor);
```

Or let the client follow every page (small catalogs, CLI tools):

```ts
const all = await client.discoverAll({ assets: ["CUSDC"] });
```

## Page shape

```ts
{
  resources: DiscoveredResource[],
  next_cursor: string | null,  // null on the last page
  has_more: boolean            // convenience mirror of next_cursor !== null
}
```

`next_cursor` is snake_case because it crosses the wire to the facilitator's HTTP API, matching the `x402Version` / `PAYMENT-REQUIRED` payload style already in use.

## Cursor semantics

Cursors are opaque to callers but deterministic: base64url of the **last resource id on the page**, anchored to an id rather than an offset.

That choice matters for a live catalog:

- An entry inserted earlier in the ordering between two calls does **not** shift the window, so the next page neither repeats nor skips an item. An offset cursor would do both.
- If the anchor entry is deleted before the next call, the walk resumes at the next id in order rather than restarting from the top and re-serving the whole catalog.
- A cursor pointing past the end returns an empty last page, not an error.
- A malformed or empty cursor throws `InvalidCursorError`.

Results are sorted by `resource` id inside the paginator, so cursor semantics hold even when the source returns entries in an unstable order. The caller's array is never mutated.

## Filters

`network` (CAIP-2) and `assets` (token contract ids) narrow the catalog *before* paging, so `limit` counts matching resources and `next_cursor` walks only the filtered set.

## Transport note

`createHttpDiscoverySource` fetches the catalog once and pages client-side — the facilitator endpoint is unpaginated today. That is the point: callers get bounded pages now, and when the facilitator grows a real cursor API only this adapter changes, not the client or the page shape. Catalog entries are untrusted input, so malformed entries are dropped rather than thrown on.
