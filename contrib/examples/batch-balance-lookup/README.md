# Batch balance lookup

Resolves a batch of `{account, token}` balance lookups concurrently via
`Promise.allSettled`, returning a same-length array of per-item results in
input order. A single failing lookup is reported per-item — it never blocks
or fails the other lookups in the batch.

## Run it

```sh
npx tsx batch-balance-lookup.ts
```

Expected output (the mock reader intentionally fails only the USDC lookup):

```
GALICE (XLM): 500000000
GBOB (USDC): FAILED — simulation failed for GBOB
GCAROL (XLM): 500000000
```

## Tests

Covers a batch with one intentionally failing lookup:

```sh
npx vitest run contrib/examples/batch-balance-lookup
```
