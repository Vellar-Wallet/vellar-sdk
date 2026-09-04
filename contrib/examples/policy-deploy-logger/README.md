# Policy Deployment Structured Logging (Issue #253)

Step-level structured logging hook wrapper for tracking multi-stage policy deployments.

## Steps Tracked
1. `deploy_instance`: Backend deploys the contract instance.
2. `attach_policy`: User signs the passkey transaction attaching policy to wallet.
3. `record_deployment`: Gateway records the active attachment.

## Outcomes
- `started`: Step execution initiated.
- `success`: Step completed successfully with details (e.g. `contractId`).
- `failed`: Step failed, attaching the error object.

## Running Tests

```sh
npx vitest run contrib/examples/policy-deploy-logger
```
