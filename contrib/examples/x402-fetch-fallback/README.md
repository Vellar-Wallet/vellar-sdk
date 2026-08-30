# x402 fetch with a lower-cost fallback

Demonstrates an x402 (HTTP 402 "pay to unlock") request that handles a
`PaymentRejectedError` by falling back **once** to a lower `maxAmount`, which
selects a cheaper payment tier that settles within the wallet's budget.

Everything runs against a **mock x402 client** and a **mock resource server**
defined in this example — no network. The mock client implements the SDK's real
[`X402Client`](../../../src/x402-types.ts) interface and throws the SDK's real
`PaymentRejectedError`, so the control flow mirrors production.

## Flow

1. The resource server answers an unpaid request with a 402 challenge listing
   two accepted tiers — **premium** (`800`) and **basic** (`400`) base units.
2. The client pays the most premium tier it can afford under `maxAmount`. With
   `maxAmount = 1000` it picks the premium `800`.
3. The facilitator verifies the payment against the wallet's remaining on-chain
   spending-limit budget (`500`). `800 > 500`, so it throws
   `PaymentRejectedError` (`reason: "over_budget"`) — exactly what happens when
   the on-chain policy blocks an over-budget transfer.
4. `fetchWithPaymentFallback` catches that error and retries **exactly once**
   with `fallbackMaxAmount = 450`. Now only the basic `400` tier is affordable;
   it is chosen, `400 <= 500`, and the facilitator settles it.
5. The unlocked resource (HTTP 200) and its settlement are returned.

A second rejection, or any non-`PaymentRejectedError`, propagates without a
further retry — the fallback happens at most once.

## Run it

```sh
npx tsx x402-fetch-fallback.ts
```

```
Remaining on-chain budget: 500 base units
Premium tier: 800, basic tier: 400

1. GET /reports/quarterly with maxAmount=1000 (fallback=450)...
  ! payment rejected (over_budget): facilitator rejected payment of 800: exceeds remaining budget 500
  > retrying once at lower maxAmount 450
2. Unlocked (paid=true, status=200): {"url":"/reports/quarterly","report":"Q3 revenue up 12% YoY","unlocked":true}
3. Settled 400 of CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC on testnet — tx mocktx-0001
4. Server quoted 2x; facilitator settle attempts: 2
   Remaining budget now: 100
```

## Tests

```sh
npx vitest run contrib/examples/x402-fetch-fallback
```
