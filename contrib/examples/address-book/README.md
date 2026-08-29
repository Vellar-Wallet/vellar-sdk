# Wallet address book

A simple in-memory address book mapping friendly names to Stellar addresses,
with `add`, `remove`, and `lookup` functions. Adding a name that's already in
use throws `DuplicateNameError`; looking up an unknown name returns
`undefined` rather than throwing.

## Run it

```sh
npx tsx address-book.ts
```

Expected output:

```
Added Alice.
Lookup Alice: GALICEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF
Lookup Unknown: undefined
Adding duplicate name rejected: An address book entry named "Alice" already exists
Lookup Alice after remove: undefined
```

## Tests

Covers add, lookup, remove, and the duplicate-name and unknown-name edge
cases:

```sh
npx vitest run contrib/examples/address-book
```
