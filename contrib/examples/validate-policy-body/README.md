# Validate a policy body before generate

Locally validates a spending-limit policy body (`{ limit, windowSeconds }`)
before it would be sent to a generate endpoint, catching obvious mistakes
early. Returns a list of every validation error found, rather than throwing
on the first one, so a caller can show all the problems at once.

## Checks

- `limit` must be a finite, positive number.
- `windowSeconds` must be an integer between 1 and 2,592,000 (30 days) — a
  window longer than that isn't a meaningful rolling window for a spending
  limit, and usually signals the value is in the wrong unit (e.g.
  milliseconds instead of seconds).

## Run it

```sh
npx tsx validate-policy-body.ts
```

Expected output:

```
Valid body errors:   []
Invalid body errors: [
  'limit must be a positive number, got -5',
  'windowSeconds must be between 1 and 2592000 (30 days), got 99999999'
]
```

## Tests

Covers a valid body and a body with multiple issues:

```sh
npx vitest run contrib/examples/validate-policy-body
```
