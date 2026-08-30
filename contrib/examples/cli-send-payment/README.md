# CLI: send a test payment

A small command-line tool that drives a real `createVellarWallet` handle —
wired to fully in-memory mock `kit`, `sac`, and `backend` dependencies — through
a create-then-pay sequence. No WebAuthn prompt, no RPC call, no relayer: it's a
reference for exercising the wallet's `pay()` flow end to end from a script.

## Usage

```sh
npx tsx cli-send-payment.ts --to <recipient> --amount <decimal> --token <USDC|XLM>
```

- `--to` — the recipient address (any non-empty string works against the mock;
  the real SDK validates against actual Stellar address rules).
- `--amount` — a decimal amount, e.g. `12.5`. Rejected if it has more
  fractional digits than the token supports (7, for both mock tokens).
- `--token` — `USDC` or `XLM` (case-insensitive). These map to fake contract
  ids defined in `cli-send-payment.ts`'s `MOCK_TOKENS`.

Flags may be given in any order.

## Sample run

```sh
$ npx tsx cli-send-payment.ts --to GRECIPIENTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX --amount 12.5 --token USDC
Creating a mock wallet...
Wallet created: CMOCKSMARTACCOUNTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
Sending 12.5 USDC to GRECIPIENTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX...
Payment submitted. Transaction hash: mockhash1000000
```

## How the mocks are wired

`createMockWallet` builds the three seams `createVellarWallet` needs
(`PasskeyKitLike`, `WalletBackend & submitTransaction`, `SacClientLike`) as
plain in-memory objects — `kit.sign` just prefixes the input with `signed:`,
`sac.getSACClient(...).transfer` returns a placeholder unsigned-tx string, and
`backend.submitTransaction` hands back an incrementing fake hash. This is the
same shape a real integration wires (a real `PasskeyKit` instance, a real
`SACClient`, and your app's backend), just swapped for deterministic fakes —
useful as a starting point for scripting SDK flows or for integration tests
that shouldn't touch a live network.

## Tests

```sh
npx vitest run contrib/examples/cli-send-payment
```

Covers argument parsing (order-independence, missing flags/values), the full
create-then-pay sequence producing a hash, an unknown `--token` being rejected
before any payment is attempted, and an over-precise `--amount` being rejected.
