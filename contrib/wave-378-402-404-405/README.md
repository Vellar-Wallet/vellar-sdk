# Wave Contributions (#378, #402, #404, #405)

This directory contains standalone implementations, tests, and documentation addressing issues #378, #402, #404, and #405.

---

## 1. V1 and V2 Authorization Entry Compatibility (#378)

- **File**: `v1-v2-auth-entry.ts` & `v1-v2-auth-entry.test.ts`
- **Description**: Provides `assertAuthEntryInvocation` supporting both V1 (`sorobanAuthorizedFunctionTypeContractFn`) and V2 (`sorobanAuthorizedFunctionTypeCreateContractHostFn` / root contract calls) authorization entry structures without breaking verification when wallet contracts migrate to V2-only verification.

---

## 2. Circuit Breaker Persistent State (#402)

- **File**: `circuit-breaker-persistence.ts` & `circuit-breaker-persistence.test.ts`
- **Description**: Provides `CircuitBreakerStorage` interface and state persistence logic across process restarts for `createCircuitBreaker`.

---

## 3. Unit Tests for HTTP Backend (#404)

- **File**: `http-backend.test.ts`
- **Description**: Full unit test coverage for `createHttpWalletBackend` in `src/http-backend.ts`, verifying wallet creation submission, contract lookup, 404 handling, and error response mapping.

---

## 4. Unit Tests for Payments Client (#405)

- **File**: `payments-client.test.ts`
- **Description**: Full unit test coverage for `createPaymentClient` in `src/payments-client.ts`, testing payment preparation, recipient address validation, non-positive amount guards, self-transfer guards, and transaction submission.
