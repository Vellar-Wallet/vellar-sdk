# Wave 447-448-449-450: Policy & Backend Improvements

## 1. Resumable Policy Deploy (#447)

`resumable-deploy.ts` wraps the policy deploy flow with resume capability.

### What it does
- `resumableDeploy()` runs deploy-instance → attach → record with retry on retryable errors (503/transport) for deploy-instance and record steps
- `resumeDeploy()` completes only the record step from a known attach tx hash, without re-issuing the passkey prompt
- `DeployPolicyError` surfaces `contractId` and `attachHash` so callers can resume
- The passkey prompt is never issued twice for one logical deploy

### Integration into Core
1. Add `DeployPolicyError` class to `src/policy-facade.ts`
2. Add `resumeDeploy()` method to the `PolicyFacade` interface and `createPolicyFacade` implementation
3. Wrap the deploy-instance and record steps in `retryIfRetryable()` (3 attempts, 500ms backoff)
4. Catch errors from attach and record steps, wrapping them in `DeployPolicyError` with the appropriate state
5. Export `DeployPolicyError` from `src/index.ts` and add to `STABLE_V1_EXPORTS`

---

## 2. Client-Side PolicyDefinition Validation (#448)

`policy-validation.ts` is a pure validator over `PolicyDefinition`.

### What it does
- Returns the same `ValidationResult` shape the server API returns
- Covers: required fields, valid policy types, owner array, threshold vs owner count, spending limit formats, address validation (via injected `isValidAddress`), non-negative amounts, timelock types
- Fast-fail convenience — the server remains authoritative

### Integration into Core
1. Move the `validatePolicyDefinitionClient` function into a new `src/policy-validation.ts` file
2. Export from `src/index.ts`, `src/v1-exports.ts`, and add to `STABLE_V1_EXPORTS`
3. Optionally wire into `src/policy-client.ts` as a pre-flight check before `validate()` calls

---

## 3. Enforcement Classification Helper (#449)

`classify-enforcement.ts` classifies a `PolicyTemplateInfo` as chain-enforced or not.

### What it does
- Returns `{ chainEnforced: boolean, explanation: string }` for any template
- `policy-contract` and `signer-limits` → chain-enforced
- `none` → not chain-enforced, explanation: "no on-chain enforcement"
- `custom-contract-pending` → not chain-enforced, explanation: "not yet available"

### Integration into Core
1. Add the `EnforcementClassification` interface and `classifyEnforcement()` function to `src/policy-types.ts`
2. Add `classifyEnforcement` to `STABLE_V1_EXPORTS` in `src/export-surface.ts`

---

## 4. Wallet Backend Contract Harness (#450)

`backend-contract-harness.ts` exports a conformance test suite for wallet backends.

### What it does
- `walletBackendContractTests(createBackend)` runs contract tests against any `HttpWalletBackend` implementation
- Covers each route: success, validation failure, upstream failure, unknown keyId
- Specifies the error contract: status codes, `WalletApiError` shape with `code` from `error` field
- 404 on `/wallet/connect` = unknown keyId → `undefined`

### Integration into Core
1. Move `walletBackendContractTests` into a new `src/backend-contract-harness.ts` file
2. Add the error contract tests from `backend-contract-harness.test.ts` into `src/client-backend-harness.test.ts`
3. Export `walletBackendContractTests` and add to `STABLE_V1_EXPORTS`
4. Add a "Contract testing" section to the root `README.md` explaining how to run against a real backend:
   ```
   npx vitest run src/backend-contract-harness.test.ts
   ```