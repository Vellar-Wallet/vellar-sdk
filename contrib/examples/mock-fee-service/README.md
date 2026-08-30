# Mock fee estimation service

A self-contained mock fee estimation function returning fixed sample fee
values (in stroops) for `low`, `medium`, and `high` priority levels. Throws
`UnknownFeePriorityError` for anything else.

## Run it

```sh
npx tsx mock-fee-service.ts
```

Expected output:

```
low: 100 stroops
medium: 10000 stroops
high: 1000000 stroops
invalid priority rejected: Unknown fee priority "urgent" — expected one of: low, medium, high
```

## Tests

Covers all three valid priority levels plus an invalid one:

```sh
npx vitest run contrib/examples/mock-fee-service
```
