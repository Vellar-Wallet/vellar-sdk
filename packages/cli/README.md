# vellar-cli

Command-line tool for discovering, quoting, paying for, and inspecting
[x402](https://x402.org) resources on Stellar.

Every command supports `--json` for machine-readable output.

## Install

```sh
npm install -g vellar-cli
```

## Commands

### `vellar search <query>`

Search the Vellar Bazaar for payable resources.

```sh
vellar search "motivational quote"
vellar search "lorem ipsum" --limit 5 --json
```

Prints the resource URL, its price per accepted scheme, and the trust block.
`settlements` and `uniquePayers` are counted from observed on-chain activity, so
they are the only fields in a listing a seller cannot write themselves.

### `vellar quote <url>`

Check the price of a resource without paying. One HTTP request: nothing is
signed and no key is read.

```sh
vellar quote https://vellar-seller-demo.onrender.com/quote
```

Every payment option in the challenge is printed, including whether fees are
sponsored. Without sponsorship the payer needs XLM of its own.

### `vellar pay <url>`

Pay for a resource and print the content.

```sh
vellar pay https://vellar-seller-demo.onrender.com/quote \
  --secret-file ~/.vellar/key \
  --max 1000000
```

`--max` is a hard ceiling in the asset's base units. Stellar Asset Contracts use
7 decimals, so `1000000` is 0.1 units. The payment is refused, unsigned, if the
price exceeds `--max`, if the seller offers no `exact` option on the chosen
network, or if the seller does not advertise sponsored fees.

Only the `exact` scheme is payable from a classic keypair. An `upto`-only seller
is reported rather than half-attempted.

> **Prefer `--secret-file`.** A secret passed as `--secret` lands in shell
> history and is visible in the process table. `VELLAR_SECRET` works too, and
> keeps it off the command line.

Roughly one testnet settlement in three fails with an empty `transaction` field,
which means nothing was spent and a fresh attempt is safe. A non-empty
`transaction` means fees were charged: do not retry.

### `vellar inspect <tx-hash>`

Look up a Stellar transaction by hash.

```sh
vellar inspect be33bb71b0a2c74c465bf0243c45e081bc7c5b66a337e2d8a5c0bbb82f54ede6
```

Prints the hash, success flag, ledger, fee charged, source account, and fee
account. On a sponsored settlement the source and fee accounts differ and the
buyer appears in neither, which is fee sponsorship shown on-chain rather than
asserted.

## Environment variables

| Variable | Meaning |
| --- | --- |
| `VELLAR_FACILITATOR_URL` | Facilitator base URL (default: the hosted instance) |
| `VELLAR_SECRET` | Payer secret key, used by `pay` when no flag is given |
| `VELLAR_NETWORK` | `testnet` (default) or `mainnet` |

## Notes

Vellar runs on `stellar:testnet` only. The hosted facilitator sleeps after 15
minutes idle, so the first call after a sleep takes roughly 45 seconds.

Debug a paid route with `GET`, never `HEAD`: a `HEAD` request carries no payment
challenge, so a correctly wired paid route looks free.

## License

Apache-2.0
