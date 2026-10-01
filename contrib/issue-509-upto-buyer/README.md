# Experimental Upto Buyer

Standalone buyer-side reference for issue #509. This code is not imported by `wallet.x402` and is not part of the published package.

## Status and trust boundary

The upto wire format is experimental pending upstream standardization (x402-foundation/x402 PR #3134). Before signing, the buyer must configure a trusted contract id and require the seller's `extra.uptoContract` to match it. The sample uses the published testnet deployment id; do not accept an arbitrary contract id supplied only by an untrusted 402 response.

The sample signs `max_amount` as the ceiling. The facilitator settles `extra.actualAmount` after service, and the returned `X-PAYMENT-RESPONSE.amount` is surfaced as `settledAmount` separately from `ceiling`.

## Serialized use

The facilitator does not route upto settlements through its channel-account pool. Concurrent settlements can fail with `txBadSeq`, so share one `UptoSettlementQueue` per facilitator and serialize the complete build/settle workflow:

```ts
const queue = new UptoSettlementQueue();
const result = await queue.run(async () => {
  const { payload, ceiling } = await createUptoPaymentPayload(options);
  const response = await sendToFacilitatorAndResource(payload);
  return { response, ceiling };
});
```

Hold the queue through the resource response and confirmed settlement, not merely until the auth payload is built.

The helper requires a funded classic `simulationSourceAccount` distinct from the payer. It is used only for simulation and is never charged. The facilitator rebuilds and sponsors the actual settlement.

## Run tests

```sh
npx vitest run contrib/issue-509-upto-buyer/upto-buyer.test.ts
```

`assertUptoRequirement`, `decodeUptoSettlement`, and `UptoSettlementQueue` are network-free. `createUptoPaymentPayload` is the live-RPC builder; it verifies the contract call tuple returned by simulation before asking the signer to sign it.

## Integration notes

To move this into the SDK, make scheme selection return exact or upto requirements, retain unsupported-scheme refusal for other values, pass a trusted upto contract through wallet config, and use the helper to build the contract invocation. Extend the public settlement result with distinct ceiling and actual fields. Keep honesty documentation explicit that the scheme and wire format are experimental.