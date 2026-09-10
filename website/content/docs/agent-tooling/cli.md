# Vellar CLI

> A command-line tool for discovering, quoting, paying for, and inspecting
> [x402](https://x402.org) (HTTP 402) resources on Stellar.
> [`vellar-cli`](https://www.npmjs.com/package/vellar-cli) gives you four
> commands: find a resource, check its price without paying, pay it and get the
> content, and look up the settlement on-chain afterwards. Every command
> supports `--json` for machine-readable output, so the CLI composes with
> `jq` and with scripts as readily as it reads in a terminal.

By the end of this page you will have paid for a real resource from the terminal
and verified the settlement on Horizon yourself. Every command output on this
page is real, captured from a live run against testnet, not illustrative.

Vellar runs on `stellar:testnet` only.

## Install

```sh
npm install -g vellar-cli
```

Published at
[npmjs.com/package/vellar-cli](https://www.npmjs.com/package/vellar-cli).

## The four commands

### `vellar search <query>`

Searches the Vellar Bazaar for payable resources.

```sh
vellar search "quote" --limit 3
```

```
https://vellar-seller-demo.onrender.com/quote
  Motivational Quote
  exact on stellar:testnet: 1000000 base units of CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
  Motivational quote of the day (paid)
  trust: 286 settlements, 268 unique payers

https://vellar-seller-demo.onrender.com/lorem
  Lorem Ipsum Generator
  exact on stellar:testnet: 100000 base units of CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
  Generate placeholder lorem ipsum text. Specify how many paragraphs or words you need.
  trust: 1 settlements, 1 unique payers

https://vellar-seller-demo.onrender.com/units
  Unit Converter
  exact on stellar:testnet: 100000 base units of CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
  Convert between units of measurement. Supports length, mass, temperature, and volume.
  trust: 2 settlements, 1 unique payers
```

The trust block is the part worth reading. `settlements` and `uniquePayers` are
counted from observed on-chain activity, so they are the only fields in a
listing that a seller cannot write themselves. Everything else, including the
service name and description, is seller-supplied text and should be read as a
claim. See [Bazaar and discovery](../concepts/bazaar-and-discovery.md).

`--json` returns the structured response with `x402Version`, `resources`,
`partialResults`, and `pagination`.

> **Note:** A `partial results` line means part of the search pipeline was
> unavailable, so the ranking is degraded rather than complete. See
> [Search and Retrieval](../architecture/search-and-retrieval.md).

### `vellar quote <url>`

Checks the price of a resource without paying. One HTTP request: nothing is
signed and no key is read.

```sh
vellar quote https://vellar-seller-demo.onrender.com/quote
```

```
URL:    https://vellar-seller-demo.onrender.com/quote
Scheme: exact
Network:stellar:testnet
Amount: 1000000 (base units)
Asset:  CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
Pay to: GAATVGLRHZXFC66GEN5QNKD56HC5JJZVHQ3P7ZJNVCCI4WKLN44FICSC
Fees:   sponsored

No payment was made and nothing was signed by this call.
```

Amounts are in the asset's base units. Stellar Asset Contracts use 7 decimals,
so `1000000` is 0.1 units.

`Fees: sponsored` means the facilitator pays the network fee from its own
sponsor account. Without it the payer needs XLM of their own, which is the
difference between a resource a zero-XLM account can pay and one it cannot.

> ⚠️ **Quote with `GET`, never `HEAD`.** A `HEAD` request carries no payment
> challenge, so a correctly wired paid route looks free. `vellar quote` always
> uses `GET`.

### `vellar pay <url>`

Pays for a resource and prints the content.

```sh
vellar pay https://vellar-seller-demo.onrender.com/quote \
  --secret-file ~/.vellar/key \
  --max 1000000
```

```
Payer:      GCBB5SUM7CEGHDDMFKEL5LTBFWLUU2B6WPK2BVGCMMCEGNHDMPW4TS7O
Paid:       1000000 base units of CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
Settlement: 9300623177657ff1fa8bdd9261fb3d4a07cd14e9f0027ba4b7a8a9fc7ade6b34
---
{"quote":"Ships are safe in harbor, but that's not what ships are for.","topic":"perseverance","settlement":{...}}
```

The summary goes to stderr and the content to stdout, so `vellar pay ... > out.json`
captures the resource and nothing else. With `--json`, only the response body is
printed.

`--max` is a hard ceiling in base units, checked **before** anything is signed.
The payment is refused, unsigned, if the price exceeds `--max`, if the seller
offers no `exact` option on the chosen network, or if the seller does not
advertise sponsored fees. A refusal costs nothing and spends nothing.

> ⚠️ **The secret never appears as a shell argument when you use
> `--secret-file`.** Shell arguments are visible to other processes through
> `ps`, and land in shell history. See [Secret key handling](#secret-key-handling).

Only the `exact` scheme is payable from a classic keypair. An `upto`-only seller
is reported rather than half-attempted, because `upto` needs a contract call
this path does not build. See [The upto scheme](../concepts/upto-scheme.md).

#### Verify the settlement yourself

The settlement above is a real transaction. Check it against Horizon without
trusting this page:

```sh
curl -s "https://horizon-testnet.stellar.org/transactions/9300623177657ff1fa8bdd9261fb3d4a07cd14e9f0027ba4b7a8a9fc7ade6b34" \
  | python3 -c \
  "import json,sys; \
  d=json.load(sys.stdin); \
  print('successful:', d['successful']); \
  print('ledger:', d['ledger']); \
  print('fee_charged:', d['fee_charged'])"
# successful: True
# ledger: 4596316
# fee_charged: 23060
```

The 23,060 stroops were paid by `GBUCR6H22CZC5OYHBJIEUS2JFZBOB63AHEGTCV6UEPMD2TMLKG2ZMIW4`,
the facilitator's sponsor, and the payer's XLM balance was unchanged across the
payment. Only 0.1 USDC moved. That is fee sponsorship shown on-chain rather than
asserted. See [Fees and Sponsorship](../reference/fees.md).

> **Note:** Roughly one testnet settlement in three fails with an **empty**
> `transaction` field, which means nothing was spent and a fresh attempt is
> safe. A **non-empty** `transaction` means fees were charged: do not retry.
> The `transaction` field is the retry decision, not the error code.

### `vellar inspect <tx-hash>`

Looks up a Stellar transaction by hash.

```sh
vellar inspect 9300623177657ff1fa8bdd9261fb3d4a07cd14e9f0027ba4b7a8a9fc7ade6b34
```

```
Hash:       9300623177657ff1fa8bdd9261fb3d4a07cd14e9f0027ba4b7a8a9fc7ade6b34
Successful: true
Ledger:     4596316
Fee:        23060 stroops
Source:     GCJGAECCUFT6G56J45NIL4DSZYWVNKCHD2KRDW7EYCWVGFKBFDK5PIKE
Fee acct:   GBUCR6H22CZC5OYHBJIEUS2JFZBOB63AHEGTCV6UEPMD2TMLKG2ZMIW4
Created:    2026-09-10T01:52:47Z

Fee was paid by a different account than the transaction source
(fee sponsorship shown on-chain, not asserted).
```

`Source` is a channel account from the facilitator's pool and `Fee acct` is the
sponsor. The buyer's address appears in neither, which is the non-custodial
property worth checking on any settlement. See
[Channel Pool](../architecture/channel-pool.md).

`--json` returns the raw Horizon transaction envelope.

## Environment variables

| Variable | Meaning |
| --- | --- |
| `VELLAR_FACILITATOR_URL` | Facilitator base URL (default: the hosted instance) |
| `VELLAR_SECRET` | Payer secret key, used by `pay` when no flag is given |
| `VELLAR_NETWORK` | `testnet` (default) or `mainnet` |

> ⚠️ **Never put a secret key in a shell argument.** Use `--secret-file` or
> `VELLAR_SECRET`.

## Secret key handling

Shell arguments are visible to other processes through `ps`, and they land in
shell history. `vellar pay` therefore accepts the secret two safer ways.

**From a file**, which keeps it out of the process table entirely:

```sh
mkdir -p ~/.vellar
echo "S..." > ~/.vellar/key
chmod 600 ~/.vellar/key

vellar pay https://vellar-seller-demo.onrender.com/quote \
  --secret-file ~/.vellar/key
```

**From the environment**:

```sh
export VELLAR_SECRET="S..."
vellar pay https://vellar-seller-demo.onrender.com/quote
```

On macOS you can source it from the keychain rather than a file:

```sh
VELLAR_SECRET="$(security find-generic-password -s vellar-cli -w)"
```

`--secret` exists for completeness, and it is the option to avoid. Anything
passed that way is readable by every other process on the machine for as long as
the command runs.

## When it fails

| Symptom | Cause | Money moved? | Fix |
| --- | --- | --- | --- |
| `Refused: price N exceeds --max M` | Layer of protection working: the ceiling is checked before signing | No | Raise `--max`, or pick a cheaper resource |
| `Refused: the seller does not advertise sponsored fees` | The challenge did not set `extra.areFeesSponsored` | No | Point at a facilitator that sponsors fees |
| `Error: no 'exact' option (seller offers: upto)` | The seller takes `upto` only, which this path does not build | No | Pay it with a client that speaks `upto` |
| `Error: provide --secret-file ...` | No secret was supplied by flag, file, or `VELLAR_SECRET` | No | Supply one. Prefer `--secret-file` |
| `Could not build the payment` | Usually no trustline to the asset, or an empty balance | No | Add the trustline and fund the account |
| `Transaction not found on testnet` | The hash is on the other network, or does not exist | n/a | A testnet hash returns 404 on mainnet Horizon and vice versa |
| The first call hangs | Free-tier cold start; the hosted instance sleeps after 15 minutes idle | No | Allow up to 120 seconds. This is not a failure |

## Next steps

- [MCP Payer](./mcp-payer.md)
- [Discover services](../buyers/discover-services.md)
- [Pay for a resource](../buyers/pay-for-a-resource.md)
- [Fees and Sponsorship](../reference/fees.md)
