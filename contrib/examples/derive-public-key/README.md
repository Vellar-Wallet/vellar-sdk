# Derive a public key from a secret key

Derives and prints the public key for a given ed25519 secret key using
`@stellar/stellar-sdk`'s `Keypair.fromSecret`.

> ⚠️ **Never use a real mainnet secret with this script.** Treat any secret
> passed as a command-line argument as compromised — it's visible in your
> shell history and process list. Testnet keys only.

## Run it

```sh
npx tsx derive-public-key.ts <secretKey>
```

Example:

```sh
npx tsx derive-public-key.ts SBLSDBW6NOP5AA6P2M4ZOIRP3MCZEOGTHDFENNAMTES4TCSPJYR4MCT6
# Public key: GAMKAXTK27YHSNPNEFBUGFJXKFQKSB32R6KVVNZP4V2DEWBIFPGPE4UG
```

A malformed secret key prints a clear error instead of a raw stack trace:

```sh
npx tsx derive-public-key.ts not-a-real-key
# Error: "not-a-real-key" is not a valid ed25519 secret key (expected a 56-char string starting with "S")
```

## Tests

```sh
npx vitest run contrib/examples/derive-public-key
```
