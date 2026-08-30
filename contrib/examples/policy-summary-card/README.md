# Policy summary card

Formats a policy record as a multi-line text summary suitable for printing
in a terminal — e.g. a CLI listing a wallet's attached policies. Includes the
policy id, type, limit, and window; a policy missing the optional `limit`
and/or `window` fields (e.g. a `signer-limits` policy with no spending cap)
omits those lines cleanly instead of printing them blank.

## Run it

```sh
npx tsx policy-summary-card.ts
```

Expected output:

```
Policy ID: policy_7f3a9c2e
Type:      spending-limit
Limit:     100 XLM/day
Window:    24h

Policy ID: policy_a1b2c3d4
Type:      signer-limits
```

## Tests

```sh
npx vitest run contrib/examples/policy-summary-card
```
