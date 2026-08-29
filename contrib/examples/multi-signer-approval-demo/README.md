# Multi-signer approval demo

Several mock signers each approve a sample transaction until a configured
threshold is met, at which point it's marked ready. Approvals are
deduplicated by signer id — a signer approving twice only counts once
toward the threshold.

## The flow

1. Construct `new MultiSignerApproval(threshold)`.
2. Each signer calls `approve(signerId)` independently and in any order.
3. `approvalCount` reports the number of **distinct** signers who've
   approved; `isReady` becomes `true` once that count reaches the threshold.

## Run it

```sh
npx tsx multi-signer-approval-demo.ts
```

Expected output (threshold 2, `signer-alice` approves twice, then
`signer-bob` approves once — reaching threshold on the second *distinct*
signer, not the third call):

```
Threshold: 2 of 3 signers
signer-alice approves...
  approvals: 1, ready: false
signer-alice approves again (should not double-count)...
  approvals: 1, ready: false
signer-bob approves...
  approvals: 2, ready: true
```

## Tests

```sh
npx vitest run contrib/examples/multi-signer-approval-demo
```
