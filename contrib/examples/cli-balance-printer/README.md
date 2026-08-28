# CLI: print a table of token balances

A small command-line tool that prints an aligned table of balances for one
account across one or more token contracts. It reads through the SDK's own
`createBalanceService`, but wired to an in-memory mock `BalanceReader`, so it
runs end to end with no live network call — no RPC, no Horizon, no keys.

## Usage

```sh
npx tsx cli-balance-printer.ts <accountId> <tokenContractId...>
```

- `<accountId>` — the account whose balances are read. Any string works
  against the mock; an account with no seeded balance simply reads as `0`.
- `<tokenContractId...>` — one or more token contract ids. Rows appear in the
  order given, and a repeated id is collapsed so no token is printed twice.

## Running it with node

Node cannot execute a `.ts` file on its own, so the tool runs through `tsx`,
which is a TypeScript loader for node — `npx tsx <file>` starts node with that
loader attached. If `tsx` is installed in the workspace you can spell the same
thing out explicitly:

```sh
node --import tsx cli-balance-printer.ts <accountId> <tokenContractId...>
```

Everything else the tool needs is in node's standard library plus the SDK
source, so there is nothing to configure and no network access involved.

## Sample run

```sh
$ npx tsx cli-balance-printer.ts \
    CMOCKACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
    CXLMMOCKCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
    CUSDCMOCKCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
    CEURCMOCKCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
Account: CMOCKACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

TOKEN  CONTRACT                                                 BALANCE
-----------------------------------------------------------------------
XLM    CXLMMOCKCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX       42
USDC   CUSDCMOCKCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX   1250.5
EURC   CEURCMOCKCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX    18.75
```

Amounts are rendered by the SDK's `formatTokenAmount`, so each token uses its
own `decimals` (EURC above has 6, the others 7) and the column is right
aligned. Bad input exits non-zero with a one-line message:

```sh
$ npx tsx cli-balance-printer.ts CMOCKACCOUNTXXXX
Error: At least one <tokenContractId> is required
```

## Known token contracts

The mock ledger recognizes three fake contract ids. Reading an id outside this
list fails before any balance is fetched, and the error lists the known ids.

| Symbol | Contract id                                               | Decimals |
| ------ | --------------------------------------------------------- | -------- |
| USDC   | `CUSDCMOCKCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`  | 7        |
| XLM    | `CXLMMOCKCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`  | 7        |
| EURC   | `CEURCMOCKCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`  | 6        |

## How the mock is wired

`createMockBalanceReader` returns a `BalanceReader` — the single-method seam
`createBalanceService` reads through — backed by a plain object of raw amounts.
An unknown token contract is rejected (a real token read against a non-token
address fails too), while an unknown holder reads as `0n`, which is what a real
token contract returns for an address that has never held the asset.

Because the reader is just a parameter, `printBalances` accepts one: pass the
RPC-backed reader from `src/balances-rpc.ts` instead and the same tool prints
live balances.

## Tests

```sh
npx vitest run contrib/examples/cli-balance-printer
```

Covers argument parsing (including the duplicate-token and missing-argument
cases), contract id resolution, the mock reader's zero/unknown behavior, the
table alignment and per-token decimals, and `printBalances` failing on an
unknown contract before issuing any read.
