# Discovery never assumes catalog durability (#874)

`discovery.ts` audits and locks down the SDK discovery path's relationship with
catalog durability.

## Audit result

`src/x402-client.ts` on `dev` performs a fresh fetch on each discovery request
and validates resource URLs with `assertCatalogEntryVerifiable`. It keeps no
persistent cache of discovered URLs and never reads a durability setting. There
is no implicit assumption that a discovered entry stays valid indefinitely.

The contrib wrapper makes that property explicit and testable:

- Each `discover()` call replaces the known URL set rather than merging into
  it, so a resource missing after a facilitator restart is treated as gone.
- Durability is re-probed on every call using the #873 helper. A prior
  `durable` verdict is never carried forward.
- When no resource reports `statsSource: "persisted"`, the result is
  `inconclusive`, not a claim that the catalog is in memory.

`discovery.test.ts` simulates a restart between two discovery calls against an
in-memory catalog and asserts the previously known resource is no longer
considered present.

## Recovery contract

The documented correct response to a vanished catalog entry is the
recatalog-on-payment recovery flow: pay again to create a fresh catalog entry
rather than retrying a stale URL. No recatalog helper exists on any upstream
branch, so this folder documents the contract instead of referencing a
non-existent symbol. A maintainer adding that helper should link it from this
README and from the discovery function comment.

## Maintainer follow-up

Add a short note to the discovery function comment in `src/x402-client.ts`
stating that discovery never assumes catalog durability and must not cache a
resource as permanently valid.

## Verification

```sh
npx vitest run contrib/vellar-sdk-873-874-875-877/874-discovery-non-assumption
```
