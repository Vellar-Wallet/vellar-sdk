# Check BigInt String Example (#114)

Provides a lightweight utility `isValidBigIntString` that checks whether a given string can be safely parsed as a non-negative `bigint`.

## Validation Rules

- Must consist exclusively of digits (`0-9`).
- Rejects decimal points (e.g. `10.5`).
- Rejects leading plus sign (e.g. `+100`).
- Rejects negative sign (e.g. `-50`).
- Rejects whitespace padding or alphabetic suffixes (e.g. `100n`).

## Examples

| Input String | Valid Non-Negative BigInt? | Reason |
| --- | --- | --- |
| `0` | **`true`** | Valid non-negative integer |
| `123456789` | **`true`** | Valid positive integer |
| `100000000000000000000` | **`true`** | Valid large bigint string |
| `+100` | **`false`** | Rejects leading plus sign |
| `-50` | **`false`** | Rejects negative numbers |
| `10.5` | **`false`** | Rejects decimal points |
| `100n` | **`false`** | Rejects non-digit characters |
| ` 123 ` | **`false`** | Rejects whitespace padding |
| `""` | **`false`** | Rejects empty string |

## Run it

```sh
npx tsx contrib/examples/check-bigint-string/check-bigint-string.ts
```

## Tests

```sh
npx vitest run contrib/examples/check-bigint-string
```
