# Check a contract id looks well-formed

Checks whether a given string looks like a valid Stellar contract id: starts
with `C`, is 56 characters, and passes `@stellar/stellar-sdk`'s `StrKey`
checksum/encoding validation.

## Example contract ids

Valid:

```
CDFDULU2JWKGMIJW6FJWJJKNB3JIDQK54YTBDQUNPZTBYXCXCSO3MVZG
```

Invalid — wrong prefix (a classic `G...` account address, not a contract):

```
GDFDULU2JWKGMIJW6FJWJJKNB3JIDQK54YTBDQUNPZTBYXCXCSO3MVZG
```

Invalid — wrong length:

```
CTOOSHORT
```

Invalid — right shape, bad checksum (last character flipped):

```
CDFDULU2JWKGMIJW6FJWJJKNB3JIDQK54YTBDQUNPZTBYXCXCSO3MVZA
```

## Run it

```sh
npx tsx check-contract-id.ts <contractId>
```

## Tests

```sh
npx vitest run contrib/examples/check-contract-id
```
