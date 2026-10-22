# Contributor Hardening Suite: Issues #668, #762, #763, #765

Per repository policy in [CONTRIBUTING.md](../../CONTRIBUTING.md) and [contrib/README.md](../../contrib/README.md), contributor pull requests must stay strictly inside `contrib/`.

This directory provides self-contained reference implementations, adversarial conformance vectors, and comprehensive unit tests addressing four issues:

| Issue | Title | Files in `contrib/issues-668-762-763-765/` | Target Core Files |
| --- | --- | --- | --- |
| **#668** | x402 untrusted vectors for valid JSON of wrong top-level type | `x402-top-level-vectors.ts`, `x402-top-level-guard.ts`, `x402-top-level-guard.test.ts` | `src/x402-untrusted-vectors.ts`, `src/x402-guards.ts`, `src/x402-untrusted.test.ts` |
| **#762** | Mint rejecting grant with duplicate policy contract IDs | `agent-mint-guard.ts`, `agent-mint-guard.test.ts` | `src/agents-facade.ts`, `src/agents-facade.test.ts` |
| **#763** | Mint rejecting `expiresAt` in the past | `agent-mint-guard.ts`, `agent-mint-guard.test.ts` | `src/agents-facade.ts`, `src/agents-facade.test.ts` |
| **#765** | Revoke idempotency against an already-revoked key | `agent-mint-guard.ts`, `agent-mint-guard.test.ts` | `src/agents-facade.ts`, `src/agents-facade.test.ts` |

A ready-to-apply patch for maintainers is provided in [`core-integration.patch`](./core-integration.patch).

---

## Running Tests

Run the test suites in this directory:

```sh
# Run all tests in this hardening suite
npx vitest run contrib/issues-668-762-763-765

# Run individual test suites
npx vitest run contrib/issues-668-762-763-765/x402-top-level-guard.test.ts
npx vitest run contrib/issues-668-762-763-765/agent-mint-guard.test.ts
```

All 49 unit tests pass cleanly.

---

## Detailed Issue Analysis and Decisions

### 1. Issue #668: x402 top-level JSON shape vectors and structural guard

- **Threat Model**: Adversary model A1 treats seller-supplied challenge responses as hostile input. A response body may parse cleanly via `JSON.parse`, yet represent a bare JSON array (`["payload"]`), bare JSON string (`"instruction: ..."`), bare number (`42`), boolean (`true`), or `null`.
- **Failure Modes Prevented**:
  1. *Property-access crashes*: Accessing `decoded.accepts` or `decoded.resource` on `null` throws an unhandled `TypeError: Cannot read properties of null (reading 'accepts')`.
  2. *Model-facing injection leaks*: If a bare string or array containing prompt-injection payloads is not rejected at the structural boundary, it could pass downstream into untrusted data fence renderers (`renderUntrusted` / `sanitizeMetadata`).
- **Design Decision**: Type-shape validation is enforced as a **distinct structural fence** that runs immediately after `JSON.parse` and before any field-level schema checks. If the container is not a non-null, non-array object, `assertPaymentRequiredShape` rejects it with `InvalidPaymentRequiredShapeError` (inheriting from `NoUsablePaymentOptionError`), ensuring no payload fields reach model-facing output.
- **Vectors Added** in `TOP_LEVEL_JSON_SHAPE_VECTORS`:
  - `top-level-json-array`
  - `top-level-empty-json-array`
  - `bare-json-string`
  - `bare-json-number`
  - `bare-json-boolean-true`
  - `bare-json-null`

---

### 2. Issue #762: Duplicate contract IDs in a grant's policies array

- **Problem**: `AgentPolicyGrant` requires an array of policy contract IDs (`policies`) that all co-sign inside `__check_auth`. While an empty array is explicitly rejected, duplicate IDs within a single grant indicate caller confusion or misconfiguration (e.g. accidentally attaching the same spending-limit policy twice).
- **Design Decision**: In consistency with the existing empty-array rejection posture, duplicate contract IDs within a single grant's `policies` array are **explicitly rejected** client-side with `InvalidAgentInputError("grant for <token> has duplicate policy: <policy>")`. Silent deduplication is avoided because it masks caller configuration bugs.
- **Cross-Grant Allowance**: The same policy contract ID appearing across *different* token grants within the same mint call remains valid and allowed (e.g., one global spending-limit policy governing both USDC and XLM grants).

---

### 3. Issue #763: Mint rejecting past `expiresAt`

- **Problem**: `MintAgentInput` accepts an optional `expiresAt` as a `Date` or unix seconds. Supplying an expiration timestamp at or before current time produces a key that is either immediately unusable or fails on-chain.
- **Design Decision**: Minting an already-expired key is **rejected client-side** before triggering any passkey prompt (`runtime.resume`) or RPC call (`runtime.addAgentKey`).
- **Error Surface**: Throws `InvalidAgentInputError("expiresAt must be in the future")`. Boundary cases (exact current timestamp and past timestamps) are consistently rejected.

---

### 4. Issue #765: Revoke idempotency against already-revoked keys

- **Problem**: Calling `revoke` twice on the same `publicKey` can easily happen if a caller retries after a network timeout without knowing whether the first transaction succeeded on-chain.
- **Design Decision**:
  - The second call must either succeed as an idempotent no-op or throw a clear, named `AgentKeyNotFoundError`, but **never** throw an unhandled or misleading error that makes it look like revocation failed.
  - In `createHardenedAgentsFacade`, an `idempotencyMode` option is supported (`"noop"` default, or `"throw-not-found"`).
  - A caller retry helper `revokeWithRetry` demonstrates how callers handle retries: catching `AgentKeyNotFoundError` confirms the key was successfully revoked on the initial attempt.

---

## Instructions for Maintainers (Integration into Core)

To lift these changes into `src/`:

1. Apply the unified patch:
   ```sh
   git apply contrib/issues-668-762-763-765/core-integration.patch
   ```

2. Or apply the changes manually:
   - **`src/x402-guards.ts`**: In `decodePaymentRequired`, add the container shape check:
     ```ts
     if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
       throw new NoUsablePaymentOptionError("PAYMENT-REQUIRED header must decode to a JSON object.");
     }
     ```
   - **`src/x402-untrusted-vectors.ts`**: Add `TOP_LEVEL_JSON_SHAPE_VECTORS`.
   - **`src/x402-untrusted.test.ts`**: Add tests asserting each vector in `TOP_LEVEL_JSON_SHAPE_VECTORS` throws `NoUsablePaymentOptionError`.
   - **`src/agents-facade.ts`**:
     - In `validateMint`, add the duplicate policy `Set` check.
     - In `toExpirationSeconds`, ensure past `expiresAt` rejection is documented in `MintAgentInput.expiresAt`.
     - In `AgentsFacade.revoke`, document the idempotency guarantee in JSDoc.
   - **`src/agents-facade.test.ts`**: Add unit tests for duplicate policies, cross-grant policy reuse, past expiration rejection, and repeat revoke calls.
