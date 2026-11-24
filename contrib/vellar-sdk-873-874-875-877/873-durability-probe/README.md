# Client-side catalog durability probe (#873)

`durability.ts` exposes `probeCatalogDurability(resources)`. It returns one of
two verdicts:

- `durable`, when any resource reports `statsSource: "persisted"`. That value
  can only come from stats restored out of a durable catalog, so it is evidence
  of a libSQL-backed instance.
- `inconclusive`, when no resource has that signal. It never returns `false` or
  `in-memory`, because a fresh catalog may simply have no resources yet.

This is an **inference from observed behavior**, not a configuration read. The
facilitator does not expose `CATALOG_DB_URL` to clients. The reason string says
so explicitly so a caller cannot mistake the probe for proof of how the server
is configured.

## Documentation to promote

`catalog-durability.md` explains the inference and its limitation in prose and
links to the existing discovery concept page. A maintainer should fold that
explanation into `website/content/docs/concepts/bazaar-and-discovery.md` and
promote the helper into `src/` if it becomes public API.

## Verification

```sh
npx vitest run contrib/vellar-sdk-873-874-875-877/873-durability-probe
```
