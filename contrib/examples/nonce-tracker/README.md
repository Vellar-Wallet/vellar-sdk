# Simple in-memory nonce tracker

Records used nonce values per account in memory, to detect and reject a
repeated nonce — useful for replay protection on a signed request.

`checkAndConsume(account, nonce)` returns `true` and marks the nonce used
the first time it's seen for that account; a second check for the same
account+nonce pair returns `false` without re-marking anything. Nonces are
tracked independently per account — the same nonce string is fresh again
for a different account.

## Run it

```sh
npx tsx nonce-tracker.ts
```

Expected output:

```
First check of nonce 'abc' for account GALICE: true
Second check of the same nonce (should be rejected): false
Same nonce, different account (should be fresh): true
```

## Tests

Covers a fresh nonce accepted and a repeated nonce rejected:

```sh
npx vitest run contrib/examples/nonce-tracker
```
