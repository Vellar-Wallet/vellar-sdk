# Validate a payment recipient address

Validates a Stellar address using an `isValidAddress`-style check before
treating it as a valid payment recipient — the same kind of check
`createVellarWallet`'s `isValidAddress` config option performs, and that the
payments client (`src/payments-client.ts`) runs before ever building a
transaction. A Vellar wallet's recipients may be either a classic account
(`G...`) or a contract (`C...`), so both are accepted.

## Example addresses

Valid classic account:

```
GCFNFDLMAQB5J6LV65KG7GNAVGBREUVB2BWSLY6U46ACK4RDZG3SO3SH
```

Valid contract:

```
CDFDULU2JWKGMIJW6FJWJJKNB3JIDQK54YTBDQUNPZTBYXCXCSO3MVZG
```

Invalid — bad checksum (last character flipped):

```
GCFNFDLMAQB5J6LV65KG7GNAVGBREUVB2BWSLY6U46ACK4RDZG3SO3SA
```

Invalid — unrecognized prefix:

```
XCFNFDLMAQB5J6LV65KG7GNAVGBREUVB2BWSLY6U46ACK4RDZG3SO3SH
```

## Run it

```sh
npx tsx validate-recipient.ts <address>
```

## Tests

```sh
npx vitest run contrib/examples/validate-recipient
```
