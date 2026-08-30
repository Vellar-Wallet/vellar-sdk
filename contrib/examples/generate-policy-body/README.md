# Generate a spending-limit policy body

Builds a spending-limit policy request body from a daily limit (in stroops)
and a rolling window (in seconds), mirroring `vellar-sdk`'s
`SpendingConstructor` shape (`src/policy-types.ts`).

## Run it

```sh
npx tsx generate-policy-body.ts <dailyLimitStroops> <windowSeconds>
```

Example invocation — a 100 XLM (1,000,000,000 stroops) daily limit over a
24-hour window:

```sh
npx tsx generate-policy-body.ts 1000000000 86400
```

Expected output:

```json
{
  "type": "spending-limit",
  "constructorArgs": {
    "dailyLimitStroops": "1000000000",
    "windowSeconds": 86400
  }
}
```

Both arguments must be positive integers — the script exits with an error
otherwise (e.g. `0`, a negative number, or non-numeric input).

## Tests

```sh
npx vitest run contrib/examples/generate-policy-body
```
