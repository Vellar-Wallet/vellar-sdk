# Compare two Stellar addresses for equality

Compares two address strings for equality after normalizing case. `null` or
`undefined` inputs return `false` rather than throwing.

## Examples

| A | B | Result |
| --- | --- | --- |
| `GABC123DEF456` | `GABC123DEF456` | `true` |
| `GABC123DEF456` | `gabc123def456` | `true` (case-insensitive) |
| `GABC123DEF456` | `GDIFFERENT789` | `false` |
| `null` | `GABC123DEF456` | `false` |
| `undefined` | `undefined` | `false` |

## Run it

```sh
npx tsx compare-addresses.ts
```

## Tests

```sh
npx vitest run contrib/examples/compare-addresses
```
