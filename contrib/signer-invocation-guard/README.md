# Signer Invocation Guard & Release Verification Suite

This module provides reference implementations, unit tests, and CI verification scripts for four assigned issues (#382, #384, #392, #393).

---

## 1. Internal Invocation Guard in Signer (`#382`)

### Problem
`SmartAccountX402Signer` implementations (`createSessionKeySigner` and `createPasskeyX402Signer`) previously lacked internal verification of `expectedInvocation`. When an auth entry was presented for signing, a malicious relayer could potentially substitute or redirect the root contract invocation target.

### Reference Implementation
- **Wrapper**: `contrib/signer-invocation-guard/signer-invocation-guard.ts`
- **Unit Tests**: `contrib/signer-invocation-guard/signer-invocation-guard.test.ts`

`withSignerInvocationGuard(signer)` wraps any `SmartAccountX402Signer` and asserts that `expectedInvocation` (if passed in options) matches the auth entry's `rootInvocation` via `assertAuthEntryInvocation(entry, expectedInvocation)` prior to signing.

### Integration into Core
To lift this contract into core SDK:
1. Update `SmartAccountX402Signer.signAuthEntry` in `src/x402-types.ts` to accept `expectedInvocation?: ExpectedInvocation`.
2. In `src/x402-signer.ts`, add `if (expectedInvocation) assertAuthEntryInvocation(entry, expectedInvocation);` inside `signAuthEntry` for both session key and passkey signers.
3. In `src/x402-client.ts`, pass `expectedInvocation: expected` into `deps.signer.signAuthEntry`.

---

## 2. Mixed Credential Type Auth Entries Test (`#384`)

### Problem
Multi-auth transactions on Soroban may include entries with different credential types (e.g. `sorobanCredentialsSourceAccount` alongside `sorobanCredentialsAddress`).

### Reference Implementation
- **Unit Test**: `contrib/signer-invocation-guard/mixed-credentials.test.ts`

Demonstrates safe handling of mixed credential arrays, ensuring `sorobanCredentialsSourceAccount` entries are skipped cleanly without throwing exceptions during signing.

---

## 3. Pre-Merge Protection Against Stacked PR Merge Races (`#392`)

### Problem
When stacked pull requests target floating or updating base branches, race conditions during merge can lead to out-of-order execution or silent regression.

### Reference Script
- **Script**: `contrib/signer-invocation-guard/verify-merged.mjs`

Validates that `HEAD` shares a clean merge-base with the current `origin/${GITHUB_BASE_REF || 'dev'}` before pre-merge checks proceed.

---

## 4. Package Exports Map Build Verification Test (`#393`)

### Problem
Package subpath exports declared in `package.json` must resolve to valid build targets to avoid breaking consumers relying on subpath imports.

### Reference Script
- **Script**: `contrib/signer-invocation-guard/verify-exports-map.mjs`

Iterates all subpaths defined in `package.json`'s `exports` map (e.g. `.`, `./client`, `./signer`, `./auth-entry`, `./types`, `./errors`) and confirms import resolution targets exist.

### Integration into Core
Add script to `package.json`:
```json
"verify:exports": "node contrib/signer-invocation-guard/verify-exports-map.mjs"
```
