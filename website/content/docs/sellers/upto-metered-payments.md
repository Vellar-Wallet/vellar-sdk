# Upto Metered Payments

> Accept usage-based payments with one buyer signature. The buyer authorizes a ceiling, you charge what was actually used, and a Soroban contract enforces that the actual never exceeds the ceiling.

By the end of this page you will have the `upto` scheme registered on your resource server, understand how to supply `actualAmount` after serving the resource, and know the one silent failure that causes a full-ceiling overcharge.

## Prerequisites

- The `@x402/stellar` package installed.
- A resource server already wired to the Vellar facilitator (see [Charge for an endpoint](./charge-for-an-endpoint.md)).
- An understanding that `upto` is experimental and that the wire shape is not final.

> ⚠️ **Upto is experimental.** It is a Vellar-specific extension of x402 v2, not yet part of the finalized x402 spec, and the wire shape may change before upstream settles on one (see [x402-foundation/x402 #3134](https://github.com/x402-foundation/x402/pull/3134)). Do not build production systems against it expecting stability.

## How it differs from exact

| | `exact` | `upto` |
| --- | --- | --- |
| Buyer signs | One specific amount | A spending ceiling |
| What settles | That exact amount | Actual usage only |
| Price known at sign time | Yes | No |
| Use for | Fixed-price calls | Metered billing |

The buyer signs one authorization covering a ceiling. You serve the resource, measure usage, and supply the actual amount. The Soroban contract then enforces that the actual never exceeds the ceiling on-ledger, before it moves any funds. That bound is enforced by the chain, not promised by the facilitator.

## 1. Register the upto scheme

```ts
import { UptoStellarScheme } from "@x402/stellar/upto/server";

server.register(
  "stellar:testnet",
  new UptoStellarScheme({
    contractId: "CDHPA64M73TUTEM4MMHIWIXINBQXH7JJXFGZMGH22VJWFJFROMR6QV2S",
  })
);
```

> **Note:** If you are running your own facilitator, set `UPTO_CONTRACT_ID` to
> the contract address in your environment. Without it the `upto` scheme is not
> registered and not served, and only the `exact` scheme runs. The hosted
> instance at `vellar-facilitator.onrender.com` has this set already. See
> [Configuration](../operators/configuration.md).

> **Note:** The facilitator advertises the contract id it will actually use in `GET /supported`, under the `upto` kind's `extra.uptoContract`. Fetch it and confirm it matches the value you register, so you are not authorizing code the facilitator did not name.

## 2. Declare the ceiling, not the price

The `amount` in your route config is the maximum the buyer authorizes. It is not what you charge. What you charge is decided later, at settlement time.

```ts
{
  scheme: "upto",
  network: "stellar:testnet",
  payTo: "GDEST...",
  price: {
    asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    amount: "1000000", // ceiling: 1_000_000 atomic units = 0.1 USDC (7 decimals)
  },
  maxTimeoutSeconds: 120,
  description: "Metered inference, billed per token generated",
}
```

Amounts are base units as strings or bigints, never floating point. Stellar Asset Contracts use 7 decimals, so `1000000` is 0.1 units and `10000000` is 1.0.

## 3. Supply actualAmount after serving

Serve the resource first, measure what was used, then set the metered actual in `extra.actualAmount` as a string in atomic units.

```ts
const result = await runInference(request);

// Measured usage, priced in atomic units (7 decimals).
const actualCharge = BigInt(result.tokensGenerated) * 100n;
const ceiling = 1_000_000n;
const charge = actualCharge > ceiling ? ceiling : actualCharge;

const settlement = await facilitator.settle({
  paymentPayload,
  paymentRequirements: {
    ...requirements,
    extra: { actualAmount: String(charge) },
  },
});

// settlement.amount is what actually settled, not the ceiling.
```

> ⚠️ **Omitting actualAmount settles the full ceiling.** This is a silent overcharge, not an error: the buyer is charged the maximum they authorized even if you served far less, and neither side sees a failure. Always set it explicitly, on every settle call, including your error paths.

`/verify` simulates at the ceiling rather than the actual, because the actual is not decided yet at verify time. `SettleResponse.amount` is the actual settled amount, while `paymentRequirements.amount` stays the ceiling throughout. Reconcile the settle response against the requirements, not the other way around.

## 4. Advertise both schemes

`wallet.x402` does not build `upto` payments today; it is exact-only. A seller accepting only `upto` cannot be paid by SDK buyers at all. Advertise both until wallet support lands.

```ts
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { UptoStellarScheme } from "@x402/stellar/upto/server";

server
  .register("stellar:testnet", new ExactStellarScheme())
  .register(
    "stellar:testnet",
    new UptoStellarScheme({
      contractId: "CDHPA64M73TUTEM4MMHIWIXINBQXH7JJXFGZMGH22VJWFJFROMR6QV2S",
    })
  );
```

## The contract argument order

If you build the invocation by hand, the deployed contract's `settle` takes exactly eight arguments, in this order. Get the order wrong and it fails before any signature is checked.

```
(token, from, to, max_amount, expiration_ledger, nonce, actual_amount, hook)
```

`hook` must be `None` (void). Anything else is refused with `invalid_upto_stellar_hook_not_supported`. There is no supported post-settle callback.

`expiration_ledger` must not exceed `current_ledger + 17280`, roughly 24 hours at 5 seconds per ledger. A further-out expiry is rejected.

## Verify a settlement

Real settlements are on the public ledger, so check one yourself rather than taking this page's word:

```sh
curl -s "https://horizon-testnet.stellar.org/transactions/be72877332bbd7f8d38511cccf00620fb20869cfedbc7530588ca856ac646d9a" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['successful'], d['ledger'])"
# → True 4252896
```

A second confirmed settlement is `72c816a63ab9da21b1403ff5199e4f21b9947c0769c55312a8cf0dc7e6ecf3db` (successful, ledger 4250665).

Three `upto` settlements are visible on [explorer.vellar.xyz](https://explorer.vellar.xyz) showing the metered actual rather than the signed ceiling: `be728773` (0.0555 USDC of a 0.15 ceiling), `f558307e` (0.0312 of 0.08), and `12f0fa5c` (0.0417 of 0.12). That is the evidence the metering is real and not a claim about it.

## Known limitation

> ⚠️ **Serialize your upto settlements.** `upto` settlement is not wired into the channel-account pool, so concurrent `upto` settlements share the sponsor's sequence number and can fail with `txBadSeq`. Queue them in your server so only one is in flight at a time.

## When it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| Buyer charged the full ceiling despite low usage | `extra.actualAmount` was not set on the settle call | Always set `extra: { actualAmount: String(charge) }`, on every path including errors |
| `txBadSeq` under concurrent requests | Upto settlement is not in the channel-account pool, so settlements share the sponsor's sequence number | Serialize settlements through a queue, one in flight at a time |
| SDK buyers cannot pay your endpoint | `wallet.x402` is exact-only and does not build `upto` payments | Register `ExactStellarScheme` alongside `UptoStellarScheme` and advertise both |
| `invalid_upto_stellar_hook_not_supported` | The `hook` argument was not `None` | Pass `None` (void) as the eighth argument; no other value is accepted |
| Settlement refused for an expiry too far ahead | `expiration_ledger` exceeded `current_ledger + 17280` | Cap the expiry at 17,280 ledgers ahead (about 24h at 5s per ledger) |

## Next steps

- [Charge for an endpoint](./charge-for-an-endpoint.md)
- [Get discovered](./get-discovered.md)
- [The upto scheme](../concepts/upto-scheme.md)
- [The payment loop](../concepts/payment-loop.md)
