# Inferring catalog durability from the client side

A facilitator's catalog is durable only when `CATALOG_DB_URL` points at a
libSQL database. That setting is server configuration and is not exposed to
clients, so a discovery client cannot read it directly.

What a client can observe is the `trust.statsSource` field on discovered
resources:

- `"observed"` means the statistics were watched live by the current process.
- `"persisted"` means the statistics were restored from a durable store.

`probeCatalogDurability` scans a discovery response and returns `durable` as
soon as it sees a resource with `"persisted"`. That is a sound positive signal:
restored stats cannot come from a catalog that only lives in memory.

When no resource reports `"persisted"`, the probe returns `inconclusive`, not
`false`. There are two explanations for a missing signal:

1. The facilitator really is running with an in-memory catalog.
2. The catalog is durable but no resource has been observed and restored yet.

A client cannot tell those apart from a single discovery response. Treat an
inconclusive result as "durability not established", and avoid caching
discovered resource URLs as if they were permanent. After a payment, use the
recatalog-on-payment recovery pattern documented in
[../874-discovery-non-assumption](../874-discovery-non-assumption/README.md)
rather than assuming a previously known URL remains valid.

The full background on catalog entries and trust fields lives in
[website/content/docs/concepts/bazaar-and-discovery.md](../../../website/content/docs/concepts/bazaar-and-discovery.md).
