# Minimal CLI argument parser

Reads named flags and positional arguments from a `process.argv`-style
array, returning a plain object with parsed flags and an array of
positionals.

## Supported syntax

- `--key=value` — a flag with a string value.
- `--key` (no `=`) — a boolean flag (`true`).
- anything else — a positional argument.

**Deliberately not supported: `--key value` (space-separated).** Without a
predefined schema of which flags take a value, that form is ambiguous —
`--dry-run positional1` can't be told apart from `--amount 100` without
knowing in advance whether `--dry-run` is boolean-only. Requiring `=` for
any flag that takes a value sidesteps the ambiguity entirely.

## Run it

```sh
npx tsx cli-arg-parser.ts
```

Expected output:

```
Input:  [
  '--network=testnet',
  '--dry-run',
  'positional1',
  '--amount=100',
  'positional2'
]
Parsed: {
  flags: { network: 'testnet', 'dry-run': true, amount: '100' },
  positionals: [ 'positional1', 'positional2' ]
}
```

## Tests

Covers a mix of flags and positionals in one call:

```sh
npx vitest run contrib/examples/cli-arg-parser
```
