# Payment Idempotency Keys

Self-contained reference for issue [#209](https://github.com/Vellar-Wallet/vellar-sdk/issues/209): optional idempotency keys on payment submit calls, so a retried submission cannot put the same payment on chain twice.

## Run tests

```bash
npx vitest run contrib/examples/issue-209-payment-idempotency/payment-idempotency.test.ts
```

## Why

`PaymentSubmitBackend.submitTransaction` in `src/payments-client.ts` has no idempotency support. After a timeout or a dropped connection the caller cannot tell a lost *response* from a failed *submission*, so retrying is both necessary and unsafe — and a double-tapped confirm button has the same effect.

## Usage

```ts
import { withIdempotency, derivePaymentIdempotencyKey } from "./payment-idempotency";

const backend = withIdempotency(myPaymentSubmitBackend);

const key = derivePaymentIdempotencyKey({
  from: session.accountId,
  to: recipient,
  asset: token.contractId,
  amount,
  network,
});

// Safe to retry: the second call returns the first call's hash, no second submit.
const { hash } = await backend.submitTransaction({ signedXdr, network, idempotencyKey: key });

// On disconnect — the cache is session-scoped.
backend.clear();
```

Omitting `idempotencyKey` passes straight through to the wrapped backend, so this is drop-in.

## Semantics

| Call | Result |
|------|--------|
| Same key, same payload | First call's result, no second submit |
| Same key, same payload, **concurrent** | Both callers share the one in-flight submission |
| Same key, **different** payload | `IdempotencyKeyConflictError` — nothing is submitted |
| Different keys | Each submits normally |
| No key | Passes through unchanged |
| Key whose submission **failed** | Evicted; the same key is retryable |

Two design points carry the guarantee:

**The payload fingerprint is cached, not just the key.** Replaying a key with a different payload means the caller reused a key across two distinct payments, or mutated one between retries. Returning the first payment's hash would report success for a payment that never went on chain, so it throws instead. The error carries both fingerprints.

**The in-flight promise is cached, not only the settled result.** Otherwise two concurrent retries both miss the cache and both submit — precisely the timeout-retry case this exists to prevent.

A rejected submission is evicted rather than cached: nothing reached the chain, so the key must stay usable.

## Configuration

| Constant | Value | Notes |
|----------|-------|-------|
| `DEFAULT_IDEMPOTENCY_CACHE_SIZE` | `256` | Keys retained; oldest evicted first |
| `MAX_IDEMPOTENCY_KEY_LENGTH` | `255` | Fits a UUID or a hash; bounds cache growth |

```ts
withIdempotency(backend, { maxEntries: 32 });
```

The cache is session-scoped and bounded by count rather than by TTL, so it is a memory bound, not an expiry policy. An evicted key re-submits — size it above the number of payments a session realistically has in flight.

## Fingerprint note

`fingerprintPayload` is FNV-1a over the length-prefixed fields. Length prefixes matter: without them `{ signedXdr: "AB", network: "testnet" }` and `{ signedXdr: "ABtestnet", network: "" }` would hash identically. It is a change detector, not a security primitive — the payload it guards is already signed, and the SDK compiles with no Node types so `crypto` is unavailable here.

`derivePaymentIdempotencyKey` builds a stable key from a payment's own fields for callers with no natural request id. Pass `nonce` to distinguish two intentionally identical payments; omit it only when a repeat of the exact same payment should be treated as a retry.
