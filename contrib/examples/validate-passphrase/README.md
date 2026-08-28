# Validate a network passphrase

Checks a given network passphrase string against `vellar-sdk`'s known
`TESTNET`/`MAINNET` passphrases (`src/config.ts`), returning which network
it matches, or `null` if unknown.

**The comparison is exact and case-sensitive** — a passphrase that differs
only by casing, or has extra surrounding whitespace, does **not** match and
returns `null`. This is deliberate: a network passphrase feeds directly into
transaction signing, so a "close enough" match would be a correctness bug
(e.g. Stellar's SDK computes different signatures for a passphrase that
differs even by a single character), not a convenience worth adding.

## Run it

```sh
npx tsx validate-passphrase.ts
```

Expected output:

```
"Test SDF Network ; September 2015" -> testnet
"Public Global Stellar Network ; September 2015" -> mainnet
"Not a real passphrase" -> unknown
"test sdf network ; september 2015" -> unknown
```

## Tests

Covers the testnet passphrase, the mainnet passphrase, and an unknown
string:

```sh
npx vitest run contrib/examples/validate-passphrase
```
