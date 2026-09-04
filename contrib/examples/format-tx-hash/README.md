# Format a transaction hash for display

Formats a full transaction hash as a shortened display string (first six and
last four characters), for showing in a UI without wrapping or truncation
mid-layout.

## Examples

| Input | Output |
| --- | --- |
| `a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2` | `a1b2c3...a1b2` |
| `shorthash123` | `shorth...h123` |
| `abc` (shorter than 6+4) | `abc` (returned unchanged) |

## Run it

```sh
npx tsx format-tx-hash.ts
```

## Tests

```sh
npx vitest run contrib/examples/format-tx-hash
```
