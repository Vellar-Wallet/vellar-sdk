# Format Relative Time Example (#112)

Converts ISO timestamps into human-readable relative time strings (such as `"5 minutes ago"`, `"2 hours ago"`). Crucially handles timestamps in the future by clearly indicating that with `"in X ..."` phrasing (e.g. `"in 10 minutes"`) rather than showing negative values.

## Examples & Expected Outputs

Assume current reference time is `2026-08-27T12:00:00.000Z`:

| Input Timestamp | Direction | Expected Relative Output |
| --- | --- | --- |
| `2026-08-27T11:59:58.000Z` | Past (<5s) | `just now` |
| `2026-08-27T11:55:00.000Z` | Past | `5 minutes ago` |
| `2026-08-27T10:00:00.000Z` | Past | `2 hours ago` |
| `2026-08-24T12:00:00.000Z` | Past | `3 days ago` |
| `2026-08-27T12:10:00.000Z` | **Future** | `in 10 minutes` |
| `2026-08-29T12:00:00.000Z` | **Future** | `in 2 days` |
| `invalid-date-string` | Invalid | `invalid date` |

## Run it

```sh
npx tsx contrib/examples/relative-time/relative-time.ts
```

## Tests

```sh
npx vitest run contrib/examples/relative-time
```
