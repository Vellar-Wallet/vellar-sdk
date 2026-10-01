# Policy Batch Ordering

Self-contained reference for issue [#242](https://github.com/Vellar-Wallet/vellar-sdk/issues/242): per-wallet ordering guarantees for queued `policy-facade` operations.

## Run tests

```bash
npx vitest run contrib/examples/issue-242-policy-batch-ordering
```

## Why

`PolicyFacade.deploy(policyId)` in `src/policy-facade.ts` has no batching or queueing at all — nothing stops two concurrent `deploy()` calls for the SAME connected wallet from interleaving their steps (server-side instance deploy, passkey attach, record) out of the order they were requested in. Attaching several policies back-to-back without awaiting each one is a natural thing to do and currently unsafe.

## Usage

```ts
import { createPerWalletQueue } from "./policy-batch-ordering";

const queue = createPerWalletQueue<string, DeployPolicyResult>({
  onOutOfOrder(event) {
    // Should never fire — a bug/bypass detector, not an expected event.
    console.error("policy queue out of order!", event);
  },
});

// Wrap the wallet's existing deploy():
function orderedDeploy(policyId: string) {
  const accountId = wallet.session!.accountId;
  return queue.enqueue(accountId, policyId, (id) => wallet.policies.deploy(id));
}

// Now concurrent calls for the SAME wallet complete in call order:
const [r1, r2, r3] = await Promise.all([
  orderedDeploy("policy-1"),
  orderedDeploy("policy-2"),
  orderedDeploy("policy-3"),
]);

// Or run a list strictly in order, stopping at the first failure:
const results = await queue.runBatch(accountId, ["policy-1", "policy-2", "policy-3"], (id) =>
  wallet.policies.deploy(id),
);
```

## Semantics

| Case | Result |
|------|--------|
| Two `enqueue()` calls, same account id | Complete strictly in call order, one at a time |
| Two `enqueue()` calls, different account ids | Run concurrently, unaffected by each other |
| An enqueued operation fails | Later operations for the same account still run — a rejection doesn't wedge the queue |
| `runBatch(accountId, inputs, run)` | Each input runs through the SAME per-account queue, strictly in the given order |
| A `runBatch` item fails | Stops immediately; throws `BatchOperationError` carrying what succeeded before the failure |
| Every operation completes in order | `onOutOfOrder` never fires (see "Design note") |

## Design note: `onOutOfOrder`

Given the queue's own construction, an operation running out of sequence for its account id should be structurally impossible — each operation only starts once the previous one for the same account has settled. `onOutOfOrder` exists anyway as a defense-in-depth check (comparing each operation's assigned sequence number against the last-completed one right before it runs), not because it's expected to fire. If it ever does, that's a bug in the queue itself, or something bypassing it — not a legitimate ordering outcome to build product logic around.

## Limits

This is generic over any single-operation async function keyed by an account id — it isn't specific to `deploy`. It queues calls made **through this wrapper**; a caller that calls `wallet.policies.deploy()` directly, bypassing the queue, is not ordered against calls made through it. Wire every call site that needs the ordering guarantee through the same `createPerWalletQueue()` instance.
