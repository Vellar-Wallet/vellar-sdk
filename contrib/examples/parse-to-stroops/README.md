# Parse a human-readable amount into stroops

Converts a human-readable XLM amount string into raw stroops as a `bigint`
(1 XLM = 10,000,000 stroops). A thin wrapper over `vellar-sdk`'s own
`parseTokenAmount` (`src/payments.ts`), fixed to XLM's 7 decimal places —
reuses the SDK's exact parsing/validation rules rather than reimplementing
them.

## Examples

| Input | Output |
| --- | --- |
| `10` | `100000000` stroops |
| `10.5` | `105000000` stroops |
| `0.0000001` | `1` stroop |
| `1.12345678` (8 decimal places) | rejected — `Amount supports at most 7 decimal places` |

## Run it

```sh
npx tsx parse-to-stroops.ts <amount>
```

## Tests

```sh
npx vitest run contrib/examples/parse-to-stroops
```
