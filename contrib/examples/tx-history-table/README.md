# Transaction history table

Formats an array of sample transaction records as an aligned text table for
terminal output, with columns for hash, amount, and timestamp. An empty
array prints a clear "No transactions." message instead of an
empty/headerless table.

## Run it

```sh
npx tsx tx-history-table.ts
```

Expected output:

```
With transactions:
HASH                    AMOUNT  TIMESTAMP
-----------------------------------------
a1b2c3d4e5f6a7b8   100.5000000  2026-01-15T09:30:00Z
f6e5d4c3b2a1f0e9     2.5000000  2026-01-15T10:12:45Z
1234567890abcdef  1000.0000000  2026-01-16T08:00:00Z

With an empty array:
No transactions.
```

## Tests

```sh
npx vitest run contrib/examples/tx-history-table
```
