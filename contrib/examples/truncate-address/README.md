# Truncate an address for display

Shortens a long Stellar address to a display-friendly form: the first six
and last four characters, joined by dots. Returns the original string
unchanged if it's already short enough.

## Examples

| Input | Output |
| --- | --- |
| `GABC123DEF456GHI789JKL012MNO345PQR678STU901VWX234YZ` | `GABC12...34YZ` |
| `CDFDULU2JWKGMIJW6FJWJJKNB3JIDQK54YTBDQUNPZTBYXCXCSO3MVZG` | `CDFDUL...MVZG` |
| `GSHORT` (shorter than 6+4) | `GSHORT` (returned unchanged) |

## Run it

```sh
npx tsx truncate-address.ts
```

## Tests

```sh
npx vitest run contrib/examples/truncate-address
```
