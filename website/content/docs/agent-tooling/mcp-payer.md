# MCP Payer

> Your agent finds a resource in the Bazaar and it costs money. This is the
> server that pays for it.
> [`vellar-mcp-x402-payer`](https://www.npmjs.com/package/vellar-mcp-x402-payer)
> is an MCP server that lets an
> AI agent pay for x402 (HTTP 402) resources on Stellar from inside its own
> runtime, under a per-call ceiling and a session budget it cannot raise. It
> runs locally beside the agent over stdio and holds exactly one key. All
> configuration is environment-only, because a tool argument is model context,
> and anything in model context is one prompt injection away from being echoed
> back out.

By the end of this page you will have the server wired into an MCP client, have
made a real testnet payment and verified it on Horizon, and understand the
difference between the two spending limits, only one of which is a security
boundary.

## How it fits together

Paying and finding are two servers, not one.

| | `vellar-facilitator-discovery` | `vellar-mcp-x402-payer` |
| --- | --- | --- |
| Role | Find resources | Pay for them |
| Holds keys | No | Yes, exactly one |
| Tools | list, search | quote, pay, pay_and_call, budget |

They are separate on purpose. The facilitator is neutral infrastructure that
strangers point wallets at, so giving it custody would invert its trust model.
An agent connects to both: one to find resources, this one to pay for them.

This server does not reimplement discovery as a general proxy.
[`x402_pay_and_call`](#x402_pay_and_callquery-max_amount) is the deliberate
exception: it reads `/discovery/search` to select a resource and pays for it in
one call, so the URL paid is the URL the facilitator returned rather than one
that passed through agent context. See
[Discover services](../buyers/discover-services.md).

## Prerequisites

- A funded testnet account holding the payment asset (see
  [Quickstart](../getting-started/quickstart.md))
- An MCP-capable runtime such as Claude Desktop, Claude Code, or Cursor

## Install

```sh
npm install vellar-mcp-x402-payer
```

## Wire it up

The same `mcpServers` config format works for Claude Desktop, Claude Code, and
Cursor. The command is `npx`, the args are `["-y", "vellar-mcp-x402-payer"]`,
and the key and asset ceilings arrive through `env`.

```jsonc
// claude_desktop_config.json (or any MCP client)
{
  "mcpServers": {
    "vellar-x402-payer": {
      "command": "npx",
      "args": ["-y", "vellar-mcp-x402-payer"],
      "env": {
        "VELLAR_X402_SECRET_FILE": "/run/secrets/x402-payer-key",
        "VELLAR_X402_ASSETS": "CBIN4HTPJM2QLJ32DTRO6OCLIMM7TR7D74JDIPVQYLNYGL7SBWOXH5ND:5000000",
        "VELLAR_X402_NETWORK": "testnet"
      }
    }
  }
}
```

> ⚠️ **Prefer `VELLAR_X402_SECRET_FILE` over `VELLAR_X402_SECRET`.** The file
> path keeps the key out of the process environment, where child processes can
> read it. Never use a mainnet secret here, and never commit a config file
> containing a real secret.

On macOS you can source the key from the keychain instead of a file:

```sh
VELLAR_X402_SECRET="$(security find-generic-password -s vellar-x402-payer -w)"
```

`VELLAR_X402_ASSETS` is both the asset allowlist and the per-asset session
ceilings. The value above allows one asset and caps cumulative spend on it at
5,000,000 base units, which is 0.5 USDC.

## Your first paid call

The demo seller at `https://vellar-seller-demo.onrender.com/quote` charges 0.1
testnet USDC with sponsored fees, so it is a cheap first target.

> **Note:** It runs on a free tier and sleeps after 15 minutes idle. The first
> call after a sleep takes roughly 45 seconds. That is a cold start, not a
> failure.

### Step 1: Quote it

Ask the price without paying. This is one HTTP request that never touches the
signer or the chain.

```
x402_quote("https://vellar-seller-demo.onrender.com/quote")
```

The server reports the price, the asset, and whether it would pay:

```
Payment required (HTTP 402).
Would pay: 1000000 base units of asset CBIN…H5ND on stellar:testnet to GBBD…FLA5.
Session ceiling remaining for that asset: 5000000 base units.
This resource is payable.
No payment was made and nothing was signed by this call.
```

If the server would refuse, it says so and names the reason. That reason is the
point of asking: the agent learns that an asset is off the allowlist, or that
the price is above what it can spend, before anything is signed.

### Step 2: Pay it

```
x402_pay("https://vellar-seller-demo.onrender.com/quote", "1000000")
```

`max_amount` is in the asset's base units as a decimal string. Stellar Asset
Contracts use 7 decimals, so `1000000` is 0.1 units and `10000000` is 1.0.

On success the unlocked content comes back with the settlement hash:

```
Paid 1000000 base units of asset CBIN…H5ND on stellar:testnet.
Settlement transaction: 9e1f3acf…a0eb9d2a
Session ceiling remaining for that asset: 4000000 base units.
Content (text/plain, 84 bytes):
```

The resource content follows inside a fenced block. If the payment took more
than one attempt, the server says so and states that the earlier attempts spent
nothing.

### Step 3: Verify it on Horizon

The settlement hash is a real Stellar transaction. Check it yourself rather than
trusting the tool output:

```sh
curl -s https://horizon-testnet.stellar.org/transactions/<hash> \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["successful"], d["ledger"])'
```

### Step 4: Check your budget

```
x402_session_budget()
```

```
Payer address: G…
Network: testnet
Per-asset session ceilings (base units):
CBIN…H5ND: 1000000 spent of 5000000, 4000000 remaining

These ceilings are enforced by this process, NOT on-chain, and reset when it
restarts. The key is a hot wallet. Do not report this as an on-chain limit.
```

That closing warning is not decoration. The next section is why.

## Your first pay_and_call

The walkthrough above needed a URL. This one does not: you describe what you
want and the tool finds it, picks the cheapest payable option, and pays for it
in a single call.

Everything below is real output from a live run against testnet.

### Step 1: Call x402_pay_and_call

```
x402_pay_and_call(query="quote", max_amount="1000000")
```

```
Query: quote
Selected: https://vellar-seller-demo.onrender.com/quote (cheapest of 1 payable result(s), from 1 found)
Paid 1000000 base units of asset CBIELTK6…QDAMA on testnet.
Settlement transaction: f78d4b90c57dd59ee73f6353d8aec4b880f567db8013f0a40d41826306c4bbb0
Session ceiling remaining for that asset: 4000000 base units.
```

The unlocked content follows inside a fenced untrusted-data block:

```
{"quote":"Ships are safe in harbor, but that's not what ships are for.","topic":"perseverance", …}
```

### Step 2: Understand the response fields

| Field | This run | What it means |
| --- | --- | --- |
| `query` | `quote` | The search query, echoed back so the agent can tell the user what it looked for |
| `selectedUrl` | `…/quote` | The URL that was discovered and paid. This is the facilitator's URL, never one retyped by the model |
| `resultsFound` | 1 | Catalog entries the Bazaar returned |
| `resultsPayable` | 1 | How many passed every filter: right asset, right network, fees sponsored, under `max_amount` |
| settlement | `f78d4b90…` | The on-chain transaction hash |
| content | the quote | The resource body, fenced as untrusted data |

`resultsFound` and `resultsPayable` are worth reading together. A large gap
between them means the Bazaar had matches this server could not pay, usually
because they were priced in an asset outside `VELLAR_X402_ASSETS`.

### Step 3: Verify it on Horizon

```sh
curl -s "https://horizon-testnet.stellar.org/transactions/f78d4b90c57dd59ee73f6353d8aec4b880f567db8013f0a40d41826306c4bbb0" \
  | python3 -c \
  "import json,sys; \
  d=json.load(sys.stdin); \
  print('successful:', d['successful']); \
  print('ledger:', d['ledger']); \
  print('fee_charged:', d['fee_charged']); \
  print('fee_account:', d['fee_account'])"
```

```
successful: True
ledger: 4601452
fee_charged: 23060
fee_account: GBUCR6H22CZC5OYHBJIEUS2JFZBOB63AHEGTCV6UEPMD2TMLKG2ZMIW4
```

The `source_account` on this transaction is
`GBG5UKF4EXHYOFQFHOO263NTZRFUSXKBRUOAPDZEKISA7CPLABH7ONV4`, a channel account
from the facilitator's pool, and `fee_account` is the sponsor. The buyer
(`GCBB5SUM…PW4TS7O`) appears in neither, and its XLM balance was unchanged
across the payment at 9999.7068997. Only 0.1 USDC moved, 0.2 down to 0.1.

That is the non-custodial property shown on-chain rather than asserted. See
[Channel Pool](../architecture/channel-pool.md) and
[Fees and Sponsorship](../reference/fees.md).

### Step 4: Check the session budget

```
x402_session_budget()
```

```
Payer address: GCBB5SUM7CEGHDDMFKEL5LTBFWLUU2B6WPK2BVGCMMCEGNHDMPW4TS7O
Network: testnet
Per-asset session ceilings (base units):
CBIELTK6…QDAMA: 1000000 spent of 5000000, 4000000 remaining
```

The ledger debited exactly 1,000,000 once, on the confirmed settlement, not once
per signed attempt. That is what keeps the limiter from drifting away from what
was actually spent when a benign settle failure is retried.

### How it differs from x402_pay

`x402_pay` requires a URL: the agent must already know what to pay for.
`x402_pay_and_call` takes a query, so the agent describes what it needs in plain
language and the tool handles discovery, selection, and payment together.

The selection logic:

1. Search the Bazaar for the query.
2. Filter to payable results: an `exact` option on the configured network, in an
   allowed asset, with `areFeesSponsored: true`, priced under `max_amount`.
3. Sort cheapest first.
4. Pay the cheapest qualifying result.

> ⚠️ **The catalog price is a claim, not a quote.** The tool re-quotes the
> selected URL against the live 402 challenge before signing, so a seller cannot
> list a low price in the catalog and serve a higher one at the resource.

The session ceiling is checked **before** the search runs, so a call that could
not pay for anything never reaches the facilitator.

### What happens when nothing qualifies

When results exist but all of them cost more than `max_amount`, the tool refuses
before signing and names the cheapest price it saw:

```
pay_and_call did not complete: nothing is under max_amount 1000000. The
cheapest payable result costs 5000000 base units of CBIELTK6…QDAMA. Nothing
was signed and nothing was spent.
```

That price is the useful part: the agent can ask the user to authorise that
specific amount instead of guessing at a higher ceiling.

When results exist but none is payable at all, the refusal says so separately,
because the fix is different:

```
pay_and_call did not complete: no result is payable by this server. 3
result(s) were found, but none offered an 'exact' option on the configured
network in an allowed asset with sponsored fees.
```

The first case means raise the ceiling; the second means this server cannot pay
those resources at any price.

## The four tools

### `x402_quote(resource_url)`

Reports a resource's price without paying. One HTTP request: it never touches
the signer, the RPC, or Horizon.

It reports the price, the asset, and whether this server would pay it, including
the reason when it would refuse. Call it before `x402_pay` when the price is not
already known.

### `x402_pay(resource_url, max_amount)`

Pays the challenge and returns the unlocked content plus the settlement hash.

`max_amount` is a hard per-call ceiling in the asset's base units, as a decimal
string. The payment is refused, unsigned, if:

- the price exceeds `max_amount`
- the asset is not in `VELLAR_X402_ASSETS`
- the challenge's network is not the configured one
- the cumulative session ceiling for that asset would be exceeded
- fee sponsorship is not explicitly declared (`extra.areFeesSponsored === true`)

If the resource needs no payment, the content is returned and nothing is spent.

### `x402_pay_and_call(query, max_amount)`

Searches the Vellar Bazaar for a resource matching the query, selects the
cheapest payable result, pays it, and returns the unlocked content plus the
settlement hash. One call, with no separate discovery and payment steps.

Use it when the user describes what they want rather than naming a URL.

- `query` is a natural-language search query, for example `"weather data API"`.
- `max_amount` is a hard ceiling in base units as a decimal string, the same
  convention as `x402_pay`.

The payment is refused, unsigned, if:

- no result matches the configured asset
- no result declares `areFeesSponsored: true`
- every result exceeds `max_amount`
- the session ceiling would be exceeded

When refusing because everything is too expensive, the tool reports the cheapest
available price, so the agent can ask the user for that specific amount rather
than guessing at a higher ceiling.

The session ceiling is checked **before** the search runs. A call that could not
pay for anything never reaches the facilitator, and never tells the model about
resources it was not able to buy.

> ⚠️ **The catalog price is a claim, not a quote.** The tool re-quotes the
> selected URL against the live 402 challenge before signing, so a seller cannot
> bait-and-switch by listing a low price in the catalog and serving a higher one
> at the resource. Price, asset, network and ceiling are all re-checked against
> what the resource actually returns.

> **On the architectural boundary.** The discovery server deliberately holds no
> keys, and the payer server deliberately does not proxy discovery.
> `x402_pay_and_call` is the deliberate exception: selecting and paying in one
> call means the URL paid is the URL the facilitator returned, not a URL that
> passed through agent context where an injected description could rewrite it.

### `x402_session_budget()`

Reports per-asset spend and remaining ceiling, plus which limit mode the server
is running in. These cannot be changed by any tool call.

## The two spending limits

This is the section to read before funding anything. There are two independent
spend limits, and only one of them is a security boundary.

| Layer | Where enforced | Defends against |
| --- | --- | --- |
| 1: process ceiling (per-call `max_amount` plus a cumulative per-asset session ceiling read from the environment at startup and absent from every tool schema) | In the same process the agent is talking to; resets when that process restarts | Mistakes: a typo, a runaway loop, a resource that costs more than expected |
| 2: chain-enforced budget (a spending-limit policy attached on-chain to the signing key in a Vellar smart account) | Inside the wallet's `__check_auth` at settlement | A compromised or manipulated agent |

Layer 1 is always on and refuses before signing. Layer 2 requires
`VELLAR_X402_WALLET`, refuses at settlement inside the wallet contract, and a
refusal from it tells the model that retrying with a larger `max_amount` will not
help.

> ⚠️ **Layer 1 is defence against mistakes; only layer 2 is defence against a
> compromised or manipulated agent.** If the key is exfiltrated, layer 1 protects
> nothing, because the attacker simply does not run this server. Without
> `VELLAR_X402_WALLET` the key is a hot wallet, so fund it with only what you are
> willing to lose.

The policy validates the token and the amount. It has no opinion on the
recipient. So "the agent cannot exceed its budget" is true, and "the agent's
funds are protected" is not: a payment redirected to another address, within the
cap, satisfies the policy completely.

> **Note:** The server states which mode it is in at startup (`spendLimit:
> chain-enforced` or `process-only`), and `x402_session_budget` says so on every
> call. Do not describe the process-only ceiling to a user as an on-chain limit.

## Proven on-chain: the layer 2 demonstration

Two payments were made through the MCP protocol against a policy-governed smart
account with a 0.5 USDC on-chain cap. The server's own limits were set
deliberately *above* the cap for both (`max_amount` 1.0 USDC, session ceiling 10
USDC), so no process-level guard could be what refused the second one.

| Payment | Amount | Outcome | Evidence |
| --- | --- | --- | --- |
| A | 0.1 USDC, under the cap | Settled | Transaction `9e1f3acf3681d8a418b7619d480eefce855f7ff9a62b5546255c52cea0eb9d2a`, `successful: true` at ledger 4141211 |
| B | 0.6 USDC, over the cap | Refused by the chain | `__check_auth` then `policy__` then `Error(Contract, #1)`; no transaction, and the session ledger untouched |

The wallet's USDC balance moved by exactly the settled amount and no more, so B
spent nothing. That is confirmed by arithmetic on-chain rather than by trusting
the error.

Check payment A yourself:

```sh
curl -s https://horizon-testnet.stellar.org/transactions/9e1f3acf3681d8a418b7619d480eefce855f7ff9a62b5546255c52cea0eb9d2a \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["successful"], d["ledger"])'
# True 4141211
```

The run is reproducible as `test/integration/layer2.integration.test.ts`.

## Configure for layer 2

To enable the chain-enforced budget:

1. Create a Vellar smart account with a spending-limit policy. See
   [Agent keys](./agent-keys.md) and [Policies](./policies.md).
2. Generate an agent session key scoped to that policy.
3. Add all three values to your MCP config:

```jsonc
"env": {
  "VELLAR_X402_WALLET": "C…",    // the smart account that pays
  "VELLAR_X402_POLICIES": "C…",  // every policy in the key's SignerLimits
  "VELLAR_X402_SECRET_FILE": "/run/secrets/x402-session-key",
  "VELLAR_X402_ASSETS": "C…:5000000",
  "VELLAR_X402_NETWORK": "testnet"
}
```

With `VELLAR_X402_WALLET` set, `VELLAR_X402_SECRET` is the wallet's agent session
key, not a standalone account.

> ⚠️ **`VELLAR_X402_POLICIES` must name every policy in the key's
> `SignerLimits`.** A missing one is rejected by the wallet before the policy is
> consulted, and the error reads like a broken signer rather than a missing
> co-signer. Setting policies without a wallet is refused at startup rather than
> ignored, so a half-configured layer 2 cannot look like a working one.

### Reading a layer 2 refusal

The wallet wraps every auth failure in its own `Error(Contract, #110)`, so the
top-level code says only "auth failed" and not why. The cause is nested:

```
[wallet] "contract try_call failed", policy__, [ ...transfer args, 6000000... ]
[policy] "VM call trapped with HostError", policy__, Error(Contract, #1)
```

A failed `policy__` call is the signal that a policy refused, which is layer 2
doing its job. A `#110` with no policy invocation at all means the signature map
is malformed instead. The two look identical from the outside and mean opposite
things, so classifying on the top-level code alone gets this backwards.

### What it costs

A policy-governed settle bids roughly 130,000 stroops and charges roughly 86,000
stroops actually on-chain (0.0086 XLM), compared to roughly 23,000 to 29,000
stroops for a plain keypair settle. The policy adds meaningful overhead at
settlement, but the facilitator's 500,000-stroop ceiling handles it comfortably.
See [Fees and Sponsorship](../reference/fees.md) for the full breakdown,
including the bid-vs-charge distinction.

## Full configuration reference

| Variable | Required | Meaning |
| --- | --- | --- |
| `VELLAR_X402_SECRET` | yes¹ | The payer's `S...` ed25519 secret |
| `VELLAR_X402_SECRET_FILE` | yes¹ | Path to a file containing it instead |
| `VELLAR_X402_ASSETS` | yes | `<assetContractId>:<sessionCeiling>` pairs, comma-separated |
| `VELLAR_X402_WALLET` | no² | The paying smart account (`C...`), enables layer 2 |
| `VELLAR_X402_POLICIES` | no² | Policy contracts in the key's `SignerLimits`, comma-separated |
| `VELLAR_X402_NETWORK` | no | `testnet` (default) or `mainnet` |
| `VELLAR_X402_RPC_URL` | no | Soroban RPC; defaults per network |
| `VELLAR_X402_MAX_RESPONSE_BYTES` | no | Inline-content cap, default `262144` |

¹ Set exactly one of the two. `VELLAR_X402_SECRET_FILE` keeps the secret out of
the process environment, where it is visible to child processes.

² Together these select the chain-enforced path. With `VELLAR_X402_WALLET` set,
`VELLAR_X402_SECRET` is the wallet's agent session key, not a standalone
account. `VELLAR_X402_POLICIES` must name every policy in that key's
`SignerLimits`: a missing one is rejected by the wallet before the policy is
consulted, and the error reads like a broken signer rather than a missing
co-signer. Setting policies without a wallet is refused at startup rather than
ignored, so a half-configured layer 2 cannot look like a working one.

`VELLAR_X402_ASSETS` is both the asset allowlist and the per-asset ceilings,
because they are the same thing: an asset with no ceiling is not payable at
all. Ceilings are per-asset rather than one global number because base units
are only comparable within a single asset. One shared total would be
meaningless across different decimals and would fail open on a
cheaply-denominated asset.

## Settlement retries are the normal path

Testnet settlements fail regularly with nothing spent. This server retries up to
3 times, signing a fresh payload on every attempt, because signatures expire in
ledgers (about 5s each) rather than wall-clock time, so a cached payload is a
payload that will be rejected.

The session ledger is debited only on a confirmed settlement, never per attempt,
so the limiter cannot drift away from what was actually spent. The number of
attempts is reported back so a slow payment is diagnosable.

The failure taxonomy below was measured, not assumed. Note that the benign
failure arrives as an HTTP 402, not a 2xx, so classifying on status alone would
mean the retry loop never runs at all.

| HTTP | settle header | `transaction` | Meaning | Retried? |
| --- | --- | --- | --- | --- |
| 200 | present | non-empty | Settled | done |
| 402 | `success:false` | **empty** | Failed before submission, nothing spent | **yes** |
| 402 | `success:false` | non-empty | Submitted, fees charged, failed on-chain | no |
| 402 | absent | n/a | Verify-stage rejection, deterministic | no |

The empty `transaction` field is the signal: the facilitator releases its fee
reservation in exactly that case because zero sponsor XLM was spent. A non-empty
hash means fees were already charged, so retrying would burn them again. That is
why the non-empty case is terminal and the hash is surfaced in the error, so the
payment stays traceable.

### Why there is no expiry safety margin

Across 22 observed settle failures, zero were expiry-shaped. Every one was an
RPC-level submission failure
(`settle_exact_stellar_transaction_submission_failed`), which a margin would not
prevent. The expiry margin was left at zero on that evidence. Revisit only if
expiry-shaped failures actually appear.

One documented consequence: if a settlement succeeds on-chain but its response is
lost, this server under-counts that spend. That is the correct trade, since layer
1 is anti-mistake and layer 2 is what actually bounds a lost-response case, but
it is a property rather than an accident.

## Payments are serialised

One key, one budget, one payment at a time. Concurrent calls would otherwise
each pass the ceiling check before either recorded a spend, and together exceed
it.

## What the agent should not believe

Resource descriptions, service names, mime types and the resource body itself
are written by whoever listed the resource. None of it may act as instructions,
and none of it may widen a spend limit.

Unlike a discovery server reading from a curated catalog, this text arrives
straight from a 402 challenge, so nothing upstream has sanitised it. Two
defences apply.

**A nonce-bearing fence.** Untrusted text is wrapped in a block whose
terminator carries an 8-hex-character nonce drawn from a CSPRNG after the
untrusted text is in hand, and never derived from it. A fixed terminator is a
string the attacker already knows, so any seller could close the fence and have
what follows read as trusted text. An unpredictable one they cannot forge.

**Sanitisation, not just fencing.** Before fencing, text has C0/C1 controls,
DEL and the Unicode format class (`\p{Cf}`, which covers zero-width characters
and the bidi overrides that can visually reorder a line so a reviewer sees
something different from what the model reads) stripped. Metadata is
additionally collapsed to a single line and clamped to 256 characters, and each
field is sanitised individually before being joined, so a newline smuggled into
one value cannot forge an extra `key: value` line.

> ⚠️ **A fenced block is not a security boundary.** The nonce makes the
> boundary unforgeable and the sanitiser removes dangerous content, but neither
> can compel a model to treat the enclosed text as data. That is a property of
> the model, not of this code. What actually bounds damage is the spend limits,
> and above all the chain-enforced budget.

### What was measured

Three injection attack variants were run through the real server and the
resulting tool output given to a fresh model instance: a loud attack with a
forged fence and a fake "AUTHORITATIVE SYSTEM NOTICE" (raise the ceiling,
redirect `payTo`), the same attack unfenced and unsanitised as a control, and a
subtler one that closed a fixed fence and appended a plausible "settlement
address rotated" note.

The model ignored the injection in all three cases. It read `payTo` from the
challenge, passed the exact quoted `max_amount`, reported the ceiling unchanged,
and named the attempt as an injection.

> **Read this carefully:** this did not demonstrate that the fence changes model
> behaviour. On these attacks the model resisted with or without it. What the
> fence demonstrably provides is mechanical: an unforgeable boundary, removal of
> dangerous characters, and the 256-char clamp truncating the attacker's address
> mid-string so it never arrived intact.
>
> Two limits: this was a single model from one family, tested on three
> hand-written attacks. A smaller or differently-tuned model may not resist at
> all. Do not generalise from this to "models are safe against injection."

## Smart accounts and the official client

Layer 2 works, but not through `@x402/stellar`'s `ExactStellarScheme`, which
cannot sign for a `C...` credential address.

`AssembledTransaction.signAuthEntries` narrows any signer result to a naked
buffer. That routes `authorizeEntry` down its ed25519 branch, which calls
`Keypair.fromPublicKey` on the entry's C-address and throws `invalid version
byte. expected 48, got 16`. The SDK's `{ signatureScVal }` escape hatch exists
for exactly this case, but `signAuthEntries` closes it off. This was reproduced
live against a deployed smart account and filed upstream as
[x402-foundation/x402 issue #3158](https://github.com/x402-foundation/x402/issues/3158)
(#3159 is a duplicate filed one hour later and closed).

The package does not wait on that fix. `x402Client.register()` accepts any
`SchemeNetworkClient`, so this package registers its own scheme, which signs the
auth entries directly and never calls `signAuthEntries`: the narrowing that
blocks the official path simply never happens. That is a documented extension
point, not a fork.

## Debugging

Diagnostics go to stderr as JSON lines, never stdout. On a stdio transport
stdout is the JSON-RPC channel, and a stray write desynchronises the protocol so
the agent sees a transport error instead of a payment error.

Use `GET`, never `HEAD`, to debug a paid route. A `HEAD` request carries no
payment challenge, so a correctly wired route looks broken: `curl -I` returns a
plain 200.

## When it fails

| Symptom | Cause | Money moved? | Fix |
| --- | --- | --- | --- |
| `/settle` returns 402 with an **empty** `transaction` | Transient Soroban RPC failure before submission | No | The server retries automatically (up to 3 attempts, fresh payload each time). If you are driving it yourself, sign a fresh payload and retry |
| `/settle` returns 402 with a **non-empty** `transaction` | Submitted and failed on-chain | **Yes**, fees were charged | Do not retry. Use the surfaced hash to trace the transaction |
| Price exceeds `max_amount` | Layer 1 refused before signing | No | Raise `max_amount`, or pick a cheaper resource |
| Asset not in `VELLAR_X402_ASSETS` | Asset is off the allowlist, refused unsigned | No | Add the asset and its session ceiling to `VELLAR_X402_ASSETS` |
| Fee sponsorship not declared | The challenge did not set `extra.areFeesSponsored === true`, refused unsigned | No | Point at a facilitator that sponsors fees |
| Policies set without a wallet | `VELLAR_X402_POLICIES` without `VELLAR_X402_WALLET`, refused at startup | No | Set `VELLAR_X402_WALLET`, or remove `VELLAR_X402_POLICIES` |
| `Error(Contract, #110)` with a nested failed `policy__` call | Layer 2 refused the payment on-chain | No | The payment is over the policy's cap. Retrying with a larger `max_amount` will not help |
| `Error(Contract, #110)` with no policy invocation | The signature map is malformed, often a policy missing from it | No | Set `VELLAR_X402_POLICIES` to every policy in the key's `SignerLimits` |
| `invalid version byte. expected 48, got 16` | The official `ExactStellarScheme` cannot sign for a `C...` credential address | No | Use this package's registered smart-account scheme; see [x402-foundation/x402 issue #3158](https://github.com/x402-foundation/x402/issues/3158) (#3159 is a duplicate filed one hour later and closed) |
| First call hangs | Free-tier facilitator cold start (sleeps after 15 min idle; first call takes roughly 45s (measured)) | No | Send a warming `GET /health` with a 120s timeout before the first payment |

## Next steps

- [Agent keys](./agent-keys.md)
- [Policies](./policies.md)
- [Discover services](../buyers/discover-services.md)
- [Spend controls](../buyers/spend-controls.md)
- [Bazaar and discovery](../concepts/bazaar-and-discovery.md)
- [Fees and Sponsorship](../reference/fees.md)
