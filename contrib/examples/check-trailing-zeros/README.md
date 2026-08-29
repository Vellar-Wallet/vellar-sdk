# Check Trailing Zeros Example (#110)

Provides a lightweight utility `hasTrailingZeros` that determines whether a decimal token amount string contains unnecessary trailing zeros after the decimal point (e.g. `"10.50"` vs `"10.5"`).

## Behavior & Rules

- **Decimal Strings**: Returns `true` if there is a decimal point and the fractional part ends with `'0'` (e.g. `10.50`, `1.000`).
- **Integer Strings**: Handles integer strings without decimal points (e.g. `100`, `0`) safely without throwing and returns `false`.

## Examples & Expected Outputs

| Amount String | Has Trailing Zeros? | Notes |
| --- | --- | --- |
| `10.50` | **`true`** | Unnecessary zero after `.5` |
| `1.000` | **`true`** | Multiple trailing zeros after decimal |
| `10.0` | **`true`** | Single trailing zero after decimal |
| `0.050` | **`true`** | Trailing zero after non-zero fraction |
| `10.5` | **`false`** | Clean normalized decimal |
| `0.05` | **`false`** | Clean fraction |
| `100` | **`false`** | Integer without decimal point (handled safely) |
| `0` | **`false`** | Single digit integer |

## Run it

```sh
npx tsx contrib/examples/check-trailing-zeros/check-trailing-zeros.ts
```

## Tests

```sh
npx vitest run contrib/examples/check-trailing-zeros
```
