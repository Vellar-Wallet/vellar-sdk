# Policy Deployment Rollback

Self-contained reference for issue [#219](https://github.com/Vellar-Wallet/vellar-sdk/issues/219): wrap the multi-step policy deployment in a saga that tracks completed steps and runs compensating rollbacks on partial failure.

## The sequence

| Step | Compensation |
| --- | --- |
| `generate` | `deletePolicy` — an orphaned generated policy still occupies its id in the service |
| `simulate` | none — read-only dry run |
| `deployInstance` | `revokeInstance` — the instance exists on chain and would otherwise stay attached, unreferenced |
| `recordDeployment` | none — last step; nothing after it can fail |

## Rules

- **Only completed steps are compensated.** If `deployInstance` throws, there is no instance to revoke.
- **Compensations run LIFO.** A later step may depend on an earlier one, so its undo goes first: revoke the instance, then delete the policy.
- **Rollback is best-effort.** A compensation that itself fails is recorded and logged, but does not abort the remaining compensations and does not replace the original error. `PolicyDeploymentRollbackError` carries `cause`, `completedSteps`, `rollback[]`, and `fullyRolledBack` so a caller can distinguish "fully unwound" from "unwound except the instance deploy".

## Logging

Every completed step, every rollback, and every failed rollback is emitted through an injected `DeploymentLogger` (`info` / `warn`). Failed rollbacks log at `warn` with the compensation's error attached — those are the cases that need an operator.

## Run tests

```bash
npx vitest run contrib/examples/issue-219-policy-deploy-rollback/policy-deploy-rollback.test.ts
```
