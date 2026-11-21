# Issues #841 and #842: settlement failures with a non-empty `transaction`

The SDK's rule (`classifySettlementFailure`, `src/x402-guards.ts`): a settlement
failure with an **empty** `transaction` never reached the chain (safe to retry
with a freshly signed payload); a **non-empty** `transaction` was submitted and
fees were charged, so it is **never retried**.

[`settlement-reconciliation.ts`](settlement-reconciliation.ts) adds the Horizon
tiebreaker for the non-empty case:

| Horizon says | State | Meaning | Retry? |
| --- | --- | --- | --- |
| `successful: false` (#842) | `confirmed-failed` | Documented baseline. The typed `SettlementTransactionFailedError` is returned with the hash attached for the caller's investigation. | Never |
| `successful: true` (#841) | `reconciliation-needed` | The facilitator reported a failure but the chain succeeded (its status reporting lags). Neither the failure reason nor a naive success is trusted. | Never |
| not found / lookup error | `unverified` | Could not confirm either way. | Never |

Caller guidance for the inconsistent #841 case: **treat Horizon as the source of
truth.** Fetch the transaction directly, check it matches the expected payment,
then reconcile your records. This is the same "verify on the chain, don't trust
one status report" stance the fee-account verification uses.

The helper never retries by itself. `handleSettlementFailure` calls your `retry`
only for an empty-`transaction`, `success: false` result that the SDK classifier
marks retryable, and the tests cross-check every documented reason code against
`classifySettlementFailure` so the two cannot drift apart.

Tests (`settlement-reconciliation.test.ts`):

- **#842** non-empty transaction + Horizon `successful: false` surfaces the typed
  error with the hash attached and no retry.
- **#841** non-empty transaction + Horizon `successful: true` surfaces
  `reconciliation-needed` with the facilitator's reason preserved, the guidance,
  and no retry; plus a consistency test against the never-retry guard for every
  documented reason code.
- Lookup failures, empty/absent transactions and no-failure results.

**Integration into core:** a maintainer can move the module next to
`src/x402-guards.ts` and wire a real Horizon `transactions().transaction(hash)`
lookup as `HorizonTransactionLookup`. Nothing outside `contrib/` is changed here.
