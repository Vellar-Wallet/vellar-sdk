# Headless Smart-Account Policy Lifecycle without a UI Framework (`#630`)

## Overview

This contrib example demonstrates the full Vellar smart-account policy lifecycle (`listTemplates` -> `generate` -> `simulate` -> `deploy`) in plain Node.js / TypeScript without any frontend framework (React, Next.js, etc.).

It starts a local mock Policy API Gateway (`startMockPolicyGateway`) and wires `createVellarWallet` with a `PolicyAttachRuntime` to execute and log every stage of attaching an on-chain policy contract to a Vellar smart account:

1. **`wallet.policies.listTemplates()`** (`GET /policies/templates`): Queries the available policy templates (`spending-limit`, `verified-recipient`), formats stroop amounts into XLM via `stroopsToXlm`, and prints the human-readable on-chain enforcement guarantee via `enforcementLabel`.
2. **`wallet.policies.generate(definition)`** (`POST /policies/generate`): Validates a `PolicyDefinition` and generates the deployable policy manifest (`status: "generated"`, `policyHash`).
3. **`wallet.policies.simulate(policy.id)`** (`POST /policies/:id/simulate`): Dry-runs the policy instance deployment for the connected wallet's `accountId` and reports `minResourceFee`.
4. **`wallet.policies.deploy(policy.id)`**:
   - **Step 4a (`POST /policies/:id/deploy-instance`)**: Triggers sponsor-funded deployment of the per-wallet policy contract instance (`contractId`).
   - **Step 4b (`policyAttach.resume` + `policyAttach.attachPolicy`)**: Resumes the passkey session and signs `kit.addPolicy(contractId)` to attach the policy contract to the smart wallet.
   - **Step 4c (`POST /policies/deploy`)**: Records the completed on-chain attach transaction hash (`attachTxHash`) and transitions the policy to `status: "deployed"`.

## Running the Example

```bash
npx tsx contrib/policy-lifecycle-node/index.ts
```

## Running the Tests

```bash
npx vitest run contrib/policy-lifecycle-node/index.test.ts
```
