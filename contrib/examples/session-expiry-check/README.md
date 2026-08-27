# Session expiry check

Checks a mock session expiry timestamp against the current time and reports
`EXPIRED` or `ACTIVE`.

## Run it

```sh
npx tsx session-expiry-check.ts <iso-timestamp>
```

Example — a timestamp in the past:

```sh
npx tsx session-expiry-check.ts 2020-01-01T00:00:00.000Z
# Session expiry (2020-01-01T00:00:00.000Z): EXPIRED
```

Example — a timestamp in the future:

```sh
npx tsx session-expiry-check.ts 2030-01-01T00:00:00.000Z
# Session expiry (2030-01-01T00:00:00.000Z): ACTIVE
```

## Tests

```sh
npx vitest run contrib/examples/session-expiry-check
```
